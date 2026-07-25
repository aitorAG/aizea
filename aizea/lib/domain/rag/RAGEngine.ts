import { db } from "@/lib/db";
import { TextChunker } from "./TextChunker";
import { EmbeddingService } from "./EmbeddingService";
import { VectorStore, type SearchResult } from "./VectorStore";
import { getLanceDbDir } from "@/lib/paths";

export interface RelevantChunk {
  id: string;
  content: string;
  chunkIndex: number;
  score: number;
}

export class RAGEngine {
  private chunker: typeof TextChunker;
  private embedder: EmbeddingService;
  private vectorStore: VectorStore;

  constructor(options?: {
    chunker?: typeof TextChunker;
    embedder?: EmbeddingService;
    vectorStore?: VectorStore;
  }) {
    this.chunker = options?.chunker ?? TextChunker;
    this.embedder = options?.embedder ?? new EmbeddingService();
    this.vectorStore =
      options?.vectorStore ??
      new VectorStore({
        uri: process.env.NODE_ENV === "test" ? "memory://" : getLanceDbDir(),
        tableName: "material_chunks",
        dimension: this.embedder.dimension,
      });
  }

  /**
   * Index a Material: chunk its text, embed the chunks, store vectors,
   * and persist TextChunk records in the database.
   *
   * Strategy: DB writes are done first inside a $transaction so the chunks
   * are always consistent. The vector store is updated after and is treated
   * as best-effort: if it fails the DB rows are the source of truth and
   * a re-index can recover the vector store later.
   */
  async indexMaterial(materialId: string): Promise<void> {
    const material = await db.material.findUnique({
      where: { id: materialId },
    });

    if (!material) {
      throw new Error(`Material not found: ${materialId}`);
    }

    const text = material.content;
    if (!text || text.trim().length === 0) {
      return;
    }

    // 1. Chunk text
    const chunks = this.chunker.chunk(text, { chunkSize: 500, overlap: 50 });

    // 2. Generate embeddings
    const embeddings = await this.embedder.embedBatch(chunks);

    const tokenCounts = chunks.map((c) => Math.ceil(c.length / 4));
    const chunkData = chunks.map((content, i) => ({
      materialId,
      chunkIndex: i,
      content,
      embedding: JSON.stringify(embeddings[i]),
      tokenCount: tokenCounts[i],
    }));

    // 3. DB-first: clear old chunks and write new ones atomically.
    //    If this fails, the vector store is untouched and the material
    //    still has its old (stale) data — recoverable on next index.
    await db.$transaction([
      db.textChunk.deleteMany({ where: { materialId } }),
      db.textChunk.createMany({ data: chunkData }),
    ]);

    // 4. Update vector store (best-effort — failure is logged, not thrown).
    //    The DB is now the source of truth; the vector store can be rebuilt.
    const vectorRecords = chunks.map((content, i) => ({
      id: `${materialId}-${i}`,
      vector: embeddings[i],
      metadata: { materialId, chunkIndex: i, content },
    }));

    try {
      await this.vectorStore.deleteByMaterialId(materialId);
      await this.vectorStore.insert(vectorRecords);
    } catch (err) {
      console.warn(
        "[RAGEngine] Vector store update failed after DB write. " +
          "Re-index to recover the vector store.",
        err
      );
    }
  }

  /**
   * Search for the most relevant chunks for a query within a specific Material.
   */
  async searchRelevant(
    query: string,
    materialId: string,
    topK: number = 5
  ): Promise<RelevantChunk[]> {
    const queryVector = await this.embedder.embed(query);
    const results = await this.vectorStore.search(queryVector, topK);

    // Filter by materialId (LanceDB may return results from other materials)
    const filtered = results.filter(
      (r: SearchResult) => r.metadata.materialId === materialId
    );

    return filtered.map((r: SearchResult) => ({
      id: r.id as string,
      content: r.metadata.content as string,
      chunkIndex: r.metadata.chunkIndex as number,
      score: r.score,
    }));
  }
}

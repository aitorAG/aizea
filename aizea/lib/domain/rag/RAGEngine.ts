import { db } from "@/lib/db";
import { TextChunker } from "./TextChunker";
import { EmbeddingService } from "./EmbeddingService";
import { VectorStore, type SearchResult } from "./VectorStore";

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
        uri: process.env.NODE_ENV === "test" ? "memory://" : undefined,
        tableName: "material_chunks",
        dimension: 1536,
      });
  }

  /**
   * Index a Material: chunk its text, embed the chunks, store vectors,
   * and persist TextChunk records in the database.
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

    // 3. Clear previous index for this material
    await this.vectorStore.deleteByMaterialId(materialId);
    await db.textChunk.deleteMany({ where: { materialId } });

    // 4. Store vectors and persist records
    const vectorRecords = chunks.map((content, i) => ({
      id: `${materialId}-${i}`,
      vector: embeddings[i],
      metadata: { materialId, chunkIndex: i, content },
    }));

    await this.vectorStore.insert(vectorRecords);

    // 5. Save TextChunk records in DB
    const tokenCounts = chunks.map((c) => Math.ceil(c.length / 4));
    await db.textChunk.createMany({
      data: chunks.map((content, i) => ({
        materialId,
        chunkIndex: i,
        content,
        embedding: JSON.stringify(embeddings[i]),
        tokenCount: tokenCounts[i],
      })),
    });
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

import { TextChunker } from "./TextChunker";
import type {
  IVectorStore,
  SearchResult,
} from "@/lib/application/ports/vector-store.port";
import type { IRagRepository } from "@/lib/application/ports/rag-repository.port";
import type { IEmbeddingProvider } from "@/lib/application/ports/embedding-provider.port";

export interface RelevantChunk {
  id: string;
  content: string;
  chunkIndex: number;
  score: number;
}

export class RAGEngine {
  private chunker: typeof TextChunker;
  private embedder: IEmbeddingProvider | undefined;
  private vectorStore: IVectorStore | undefined;
  private repository: IRagRepository | undefined;

  constructor(options?: {
    chunker?: typeof TextChunker;
    embedder?: IEmbeddingProvider;
    vectorStore?: IVectorStore;
    repository?: IRagRepository;
  }) {
    this.chunker = options?.chunker ?? TextChunker;
    // El proveedor de embeddings, el almacén vectorial (lancedb) y el
    // repositorio Prisma se inyectan por el composition root / factory de
    // infra. Sustituye el antiguo acoplamiento directo a `EmbeddingService`,
    // `VectorStore` (lancedb) + `@/lib/db`.
    this.embedder = options?.embedder;
    this.vectorStore = options?.vectorStore;
    this.repository = options?.repository;
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
    if (!this.repository || !this.vectorStore || !this.embedder) {
      throw new Error(
        "RAGEngine.indexMaterial requiere repository, vectorStore y embedder inyectados."
      );
    }
    const repository = this.repository;
    const vectorStore = this.vectorStore;
    const embedder = this.embedder;

    const text = await repository.findMaterialContent(materialId);

    if (text === null) {
      throw new Error(`Material not found: ${materialId}`);
    }

    if (text.trim().length === 0) {
      return;
    }

    // 1. Chunk text
    const chunks = this.chunker.chunk(text, { chunkSize: 500, overlap: 50 });

    // 2. Generate embeddings
    const embeddings = await embedder.embedBatch(chunks);

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
    await repository.replaceChunks(materialId, chunkData);

    // 4. Update vector store (best-effort — failure is logged, not thrown).
    //    The DB is now the source of truth; the vector store can be rebuilt.
    const vectorRecords = chunks.map((content, i) => ({
      id: `${materialId}-${i}`,
      vector: embeddings[i],
      metadata: { materialId, chunkIndex: i, content },
    }));

    try {
      await vectorStore.deleteByMaterialId(materialId);
      await vectorStore.insert(vectorRecords);
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
    if (!this.vectorStore || !this.embedder) {
      throw new Error(
        "RAGEngine.searchRelevant requiere vectorStore y embedder inyectados."
      );
    }
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

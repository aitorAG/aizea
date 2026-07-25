// IEmbeddingProvider — port for text embedding.
//
// Concrete implementations live in lib/infrastructure/ai/.
// The `dimensions` property is exposed so VectorStore, RAGEngine,
// and any other consumer can initialise schemas correctly without
// hardcoding 1536.

export interface IEmbeddingProvider {
  /**
   * Embed a single text. Returns a vector of `dimensions` elements.
   * Falls back to a dummy vector when no API key is configured.
   */
  embed(text: string): Promise<number[]>;

  /**
   * Embed multiple texts in one batch request (more efficient than N × embed).
   */
  embedBatch(texts: string[]): Promise<number[][]>;

  /**
   * Number of dimensions of the vectors produced by this provider.
   * Used to initialise VectorStore and validate schema compatibility.
   */
  readonly dimensions: number;

  /**
   * Return a deterministic pseudo-random vector of the correct dimensions.
   * Used in dummy / test mode when no real API key is available.
   */
  dummyVector(seed?: string): number[];
}

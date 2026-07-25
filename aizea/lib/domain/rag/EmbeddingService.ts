// EmbeddingService — backwards-compatible wrapper over OpenRouterEmbeddingProvider.
//
// All existing callers compile without change.
// New code should inject IEmbeddingProvider via the composition root.

import { OpenRouterEmbeddingProvider } from "@/lib/infrastructure/ai/openrouter-embedding.provider";

export class EmbeddingService {
  private readonly provider: OpenRouterEmbeddingProvider;

  constructor(options?: { model?: string; dimension?: number }) {
    this.provider = new OpenRouterEmbeddingProvider(
      undefined,
      options?.model ? async () => options.model! : undefined,
      options?.dimension ?? 1536
    );
  }

  get dimension(): number {
    return this.provider.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.provider.embedBatch(texts);
  }
}

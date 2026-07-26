// embedding-service — backwards-compatible wrapper over
// OpenRouterEmbeddingProvider.
//
// Vivía en `lib/domain/rag/EmbeddingService.ts`. La Fase 1 (purificación del
// dominio) lo movió a infraestructura: es un shim que construye un provider
// concreto de OpenRouter. Ahora implementa `IEmbeddingProvider` completo
// (delegando en el provider) para poder inyectarse directamente en los
// servicios de dominio que dependen del puerto.
//
// Se conserva el getter `dimension` (singular) por compatibilidad con la
// factory de RAG y otros consumidores previos.

import { OpenRouterEmbeddingProvider } from "@/lib/infrastructure/ai/openrouter-embedding.provider";
import type { IEmbeddingProvider } from "@/lib/application/ports/embedding-provider.port";

export class EmbeddingService implements IEmbeddingProvider {
  private readonly provider: OpenRouterEmbeddingProvider;

  constructor(options?: { model?: string; dimension?: number }) {
    this.provider = new OpenRouterEmbeddingProvider(
      undefined,
      options?.model ? async () => options.model! : undefined,
      options?.dimension ?? 1536
    );
  }

  /** IEmbeddingProvider contract (plural). */
  get dimensions(): number {
    return this.provider.dimensions;
  }

  /** Backward-compatible alias (singular) used by the RAG factory. */
  get dimension(): number {
    return this.provider.dimensions;
  }

  async embed(text: string): Promise<number[]> {
    return this.provider.embed(text);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.provider.embedBatch(texts);
  }

  dummyVector(seed?: string): number[] {
    return this.provider.dummyVector(seed);
  }
}

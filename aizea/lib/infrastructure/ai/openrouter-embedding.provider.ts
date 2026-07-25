// OpenRouter Embedding provider — concrete implementation of IEmbeddingProvider.

import type { IEmbeddingProvider } from "@/lib/application/ports/embedding-provider.port";
import { LLMProviderError, withRetries, DEFAULT_LLM_RETRY_POLICY } from "@/lib/domain/ai/llm-error";
import { getApiKey, getEmbedModel } from "@/lib/config-service";

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_TIMEOUT_MS = 120_000;
const DUMMY_KEY_SENTINEL = "test-api-key";

export class OpenRouterEmbeddingProvider implements IEmbeddingProvider {
  readonly dimensions: number;

  constructor(
    private readonly getKey: () => Promise<string> = getApiKey,
    private readonly getModel: () => Promise<string> = getEmbedModel,
    dimensions = 1536
  ) {
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    if (await this._isDummyMode()) return this.dummyVector(text);
    const results = await this.embedBatch([text]);
    return results[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (await this._isDummyMode()) return texts.map((t) => this.dummyVector(t));
    const [model, apiKey] = await Promise.all([this.getModel(), this.getKey()]);
    return withRetries(() => this._fetchEmbeddings(texts, model, apiKey), DEFAULT_LLM_RETRY_POLICY);
  }

  dummyVector(seed = ""): number[] {
    const vec: number[] = [];
    let s = 0;
    for (let i = 0; i < seed.length; i++) {
      s = (s * 31 + seed.charCodeAt(i)) % 2147483647;
    }
    for (let i = 0; i < this.dimensions; i++) {
      s = (s * 1103515245 + 12345) % 2147483647;
      vec.push((s / 2147483647) * 2 - 1);
    }
    return vec;
  }

  private async _isDummyMode(): Promise<boolean> {
    const key = await this.getKey();
    return !key || key === DUMMY_KEY_SENTINEL;
  }

  private async _fetchEmbeddings(texts: string[], model: string, apiKey: string): Promise<number[][]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, input: texts }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) {
        const body = await response.text();
        const retryAfterMs = response.headers.get("Retry-After")
          ? parseInt(response.headers.get("Retry-After")!, 10) * 1000
          : undefined;
        throw new LLMProviderError({
          kind: response.status === 429 ? "rate_limit" : "server_error",
          message: `OpenRouter embeddings error (${response.status}): ${body}`,
          providerName: "openrouter-embeddings",
          statusCode: response.status,
          retryAfterMs,
        });
      }
      const data = await response.json();
      return (data.data as { embedding: number[] }[]).map((d) => d.embedding);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof LLMProviderError) throw err;
      throw new LLMProviderError({
        kind: "timeout",
        message: `OpenRouter embeddings timed out after ${DEFAULT_TIMEOUT_MS}ms`,
        providerName: "openrouter-embeddings",
        cause: err,
      });
    }
  }
}

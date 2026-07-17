import { config } from "@/lib/config";
import { getApiKey, getEmbedModel } from "@/lib/config-service";

const OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);
// Final fallback model if neither the DB nor env vars specify one.
const FALLBACK_EMBED_MODEL = "openai/text-embedding-3-small";
// API key sentinel that means "no real key, use dummy embeddings".
const DUMMY_KEY_SENTINEL = "test-api-key";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class OpenRouterHTTPError extends Error {
  constructor(public status: number, message: string) {
    super(`OpenRouter error (${status}): ${message}`);
  }
}

async function fetchEmbeddings(
  texts: string[],
  model: string,
  apiKey: string
): Promise<number[][]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || config.openrouter.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.text();
      throw new OpenRouterHTTPError(response.status, err);
    }

    const data = await response.json();
    const embeddings: number[][] = data.data.map(
      (item: { embedding: number[] }) => item.embedding
    );
    return embeddings;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenRouter embeddings request timed out after 120s");
    }

    throw error;
  }
}

export class EmbeddingService {
  private dimension: number;
  /** Optional explicit model override (e.g. for tests). null = use config-service. */
  private explicitModel: string | null;

  constructor(options?: { model?: string; dimension?: number }) {
    this.explicitModel = options?.model ?? null;
    this.dimension = options?.dimension ?? 1536;
  }

  /**
   * Resolve the embedding model to use. Honors the explicit constructor
   * override, otherwise queries the config service (DB > env > default).
   */
  private async _resolveModel(): Promise<string> {
    if (this.explicitModel) return this.explicitModel;
    return getEmbedModel();
  }

  /**
   * True when the current API key is the dummy sentinel (no real key
   * configured). When true, we return deterministic dummy vectors so
   * the rest of the app keeps working in local / test environments.
   */
  private async _isDummyMode(): Promise<boolean> {
    const key = await getApiKey();
    return !key || key === DUMMY_KEY_SENTINEL;
  }

  /**
   * Generate an embedding vector for a single text.
   * Falls back to a deterministic dummy vector when no API key is available
   * (useful for tests and local development).
   */
  async embed(text: string): Promise<number[]> {
    if (await this._isDummyMode()) {
      return this._dummyVector(text);
    }

    const embeddings = await this.embedBatch([text]);
    return embeddings[0];
  }

  /**
   * Generate embeddings for multiple texts in a single request.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (await this._isDummyMode()) {
      return texts.map((t) => this._dummyVector(t));
    }

    const [model, apiKey] = await Promise.all([
      this._resolveModel(),
      getApiKey(),
    ]);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await fetchEmbeddings(texts, model, apiKey);
      } catch (error) {
        if (error instanceof OpenRouterHTTPError) {
          if (RETRYABLE_STATUS_CODES.has(error.status) && attempt < MAX_RETRIES - 1) {
            await delay(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          throw error;
        }

        if (error instanceof Error && error.message.includes("timed out after 120s")) {
          throw error;
        }

        if (attempt < MAX_RETRIES - 1) {
          await delay(RETRY_DELAYS_MS[attempt]);
          continue;
        }

        throw error;
      }
    }

    throw new Error("Embedding request failed after max retries");
  }

  /**
   * Produce a deterministic pseudo-random vector seeded by the input text.
   * This allows tests to assert on exact values without network calls.
   */
  private _dummyVector(text: string): number[] {
    const vec: number[] = [];
    let seed = 0;
    for (let i = 0; i < text.length; i++) {
      seed = (seed * 31 + text.charCodeAt(i)) % 2147483647;
    }
    for (let i = 0; i < this.dimension; i++) {
      // Simple LCG pseudo-random
      seed = (seed * 1103515245 + 12345) % 2147483647;
      vec.push((seed / 2147483647) * 2 - 1);
    }
    return vec;
  }
}

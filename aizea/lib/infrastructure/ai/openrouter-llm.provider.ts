// OpenRouter LLM provider — concrete implementation of ILLMProvider.
//
// This is the ONLY place that knows about the OpenRouter wire format.
// Callers (SlideService, UnitExtractor, TreeBuilder, …) depend on
// ILLMProvider and never import this file directly.

import type { ILLMProvider, ChatMessage, ChatOptions } from "@/lib/application/ports/llm-provider.port";
import { LLMProviderError, withRetries, DEFAULT_LLM_RETRY_POLICY } from "@/lib/domain/ai/llm-error";
import { getApiKey, getChatModel } from "@/lib/config-service";
import { CircuitBreaker } from "@/lib/infrastructure/circuit-breaker";
import { openRouterChatBreaker } from "@/lib/infrastructure/ai/openrouter-breakers";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 120_000;

export class OpenRouterLLMProvider implements ILLMProvider {
  readonly name = "openrouter";

  constructor(
    private readonly getKey: () => Promise<string> = getApiKey,
    private readonly getModel: () => Promise<string> = getChatModel,
    // Fase 2.5 — breaker compartido de backpressure. Inyectable para tests.
    private readonly breaker: CircuitBreaker = openRouterChatBreaker
  ) {}

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    // El breaker envuelve la llamada YA reintentada: tras N peticiones
    // consecutivas fallidas (salud de endpoint) abre y falla rápido.
    return this.breaker.execute(() =>
      withRetries(() => this._chatOnce(messages, options), DEFAULT_LLM_RETRY_POLICY)
    );
  }

  async chatJSON<T>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
    const raw = await this.chat(messages, { ...options, json: true });
    // Strip markdown code fences that some models add.
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new LLMProviderError({
        kind: "invalid_response",
        message: "LLM response is not valid JSON",
        providerName: this.name,
        cause: err,
      });
    }
  }

  private async _chatOnce(messages: ChatMessage[], options: ChatOptions): Promise<string> {
    const [apiKey, model] = await Promise.all([this.getKey(), this.getModel()]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: options.model ?? model,
          messages,
          temperature: options.temperature ?? 0.4,
          max_tokens: options.maxTokens ?? 8000,
          ...(options.json ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const body = await response.text();
        const retryAfterHeader = response.headers.get("Retry-After");
        const retryAfterMs = retryAfterHeader
          ? parseInt(retryAfterHeader, 10) * 1000
          : undefined;
        const kind =
          response.status === 429
            ? "rate_limit"
            : response.status === 401
              ? "auth_error"
              : response.status === 402
                ? "quota_exceeded"
                : [500, 502, 503].includes(response.status)
                  ? "server_error"
                  : "unknown";
        throw new LLMProviderError({
          kind,
          message: `OpenRouter error (${response.status}): ${body}`,
          providerName: this.name,
          statusCode: response.status,
          retryAfterMs,
        });
      }

      const data = await response.json();
      return data.choices[0].message.content as string;
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof LLMProviderError) throw err;
      // AbortController fires with an AbortError
      throw new LLMProviderError({
        kind: "timeout",
        message: `OpenRouter request timed out after ${DEFAULT_TIMEOUT_MS}ms`,
        providerName: this.name,
        cause: err,
      });
    }
  }
}

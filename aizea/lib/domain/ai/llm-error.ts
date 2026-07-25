// LLMProviderError — typed error for LLM provider failures.
//
// Replaces the private `OpenRouterHTTPError` classes scattered in
// LLMClient.ts and EmbeddingService.ts. Exported so callers can
// narrow on kind to decide whether to retry, surface to the user,
// or silently fall back.

export type LLMErrorKind =
  | "rate_limit"       // 429
  | "server_error"     // 500 / 502 / 503
  | "timeout"          // AbortController timeout
  | "invalid_response" // Unparseable / empty response
  | "auth_error"       // 401
  | "quota_exceeded"   // 402 / quota
  | "unknown";

export class LLMProviderError extends Error {
  readonly kind: LLMErrorKind;
  readonly providerName: string;
  readonly statusCode: number | undefined;
  /** Value of the Retry-After header in ms, when present. */
  readonly retryAfterMs: number | undefined;
  readonly cause: unknown;

  constructor(params: {
    kind: LLMErrorKind;
    message: string;
    providerName: string;
    statusCode?: number;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "LLMProviderError";
    this.kind = params.kind;
    this.providerName = params.providerName;
    this.statusCode = params.statusCode;
    this.retryAfterMs = params.retryAfterMs;
    this.cause = params.cause;
    Object.setPrototypeOf(this, LLMProviderError.prototype);
  }

  /** True when the error is transient and the request can be retried. */
  get isRetryable(): boolean {
    return (
      this.kind === "rate_limit" ||
      this.kind === "server_error"
      // Note: "timeout" is intentionally NOT retryable — a 120s timeout
      // indicates a persistent network issue; immediate retry would just
      // add another 120s wait. Callers can always catch and retry manually.
    );
  }
}

// ---------- Retry policy ----------

export interface RetryPolicyConfig {
  maxRetries: number;
  delaysMs: number[];
  retryableStatusCodes: Set<number>;
}

export const DEFAULT_LLM_RETRY_POLICY: RetryPolicyConfig = {
  maxRetries: 3,
  delaysMs: [1_000, 2_000, 4_000],
  retryableStatusCodes: new Set([429, 500, 502, 503]),
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute `fn` with automatic retries according to `policy`.
 * `policy.maxRetries` = total number of attempts (not number of retries after first).
 * So maxRetries=3 → up to 3 fetch calls (consistent with original LLMClient.ts behaviour).
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  policy: RetryPolicyConfig = DEFAULT_LLM_RETRY_POLICY
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < policy.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Last attempt — do not sleep, just fall through and re-throw.
      if (attempt === policy.maxRetries - 1) break;

      // Only retry when the error is flagged as retryable.
      if (err instanceof LLMProviderError) {
        if (!err.isRetryable) break;
        const waitMs =
          err.retryAfterMs ??
          policy.delaysMs[attempt] ??
          policy.delaysMs[policy.delaysMs.length - 1];
        await sleep(waitMs);
      } else {
        // Unknown error (network, etc.) — use the default schedule.
        const waitMs =
          policy.delaysMs[attempt] ??
          policy.delaysMs[policy.delaysMs.length - 1];
        await sleep(waitMs);
      }
    }
  }

  throw lastError;
}

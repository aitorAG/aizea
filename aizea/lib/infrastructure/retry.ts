export interface RetryOptions {
  maxAttempts?: number;
  baseDelay?: number;
  backoff?: "exponential" | "linear";
}

export async function retry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    backoff = "exponential",
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isRecoverable =
        error instanceof Error && "recoverable" in error
          ? (error as Error & { recoverable: boolean }).recoverable === true
          : false;

      if (!isRecoverable || attempt === maxAttempts) {
        break;
      }

      const delayMs =
        backoff === "exponential"
          ? baseDelay * Math.pow(2, attempt - 1)
          : baseDelay * attempt;

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

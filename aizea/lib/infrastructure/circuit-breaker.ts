export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private nextAttempt = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000;
  }

  getState(): CircuitBreakerState {
    if (this.state === "open" && Date.now() >= this.nextAttempt) {
      this.state = "half-open";
    }
    return this.state;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === "open") {
      throw new Error(
        `Circuit breaker is OPEN. Retry after ${this.resetTimeout}ms`
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failureCount = 0;
    this.state = "closed";
  }

  private onFailure(): void {
    this.failureCount += 1;

    if (this.failureCount >= this.failureThreshold) {
      this.state = "open";
      this.nextAttempt = Date.now() + this.resetTimeout;
    }
  }
}

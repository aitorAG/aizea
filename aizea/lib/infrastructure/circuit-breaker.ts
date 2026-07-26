export type CircuitBreakerState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  resetTimeout?: number;
  /**
   * Fase 2.5 — predicado que decide si un error cuenta como fallo de salud
   * del endpoint (y por tanto abre el circuito). Los errores para los que
   * devuelve `false` se re-lanzan sin afectar el estado del breaker (p.ej.
   * `auth_error`/`invalid_response`: no se arreglan esperando). Default:
   * todos los errores cuentan (comportamiento previo, retrocompatible).
   */
  isFailure?: (error: unknown) => boolean;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = "closed";
  private failureCount = 0;
  private nextAttempt = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly isFailure: (error: unknown) => boolean;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.isFailure = options.isFailure ?? (() => true);
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
      // Fase 2.5 — solo los fallos de salud del endpoint mueven el breaker.
      // Un error que el predicado descarta (p.ej. auth) se propaga sin
      // contar como fallo ni resetear el contador de éxitos.
      if (this.isFailure(error)) {
        this.onFailure();
      }
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

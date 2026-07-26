// Fase 2.5 — circuit breakers compartidos para los endpoints de OpenRouter.
//
// El pipeline crea una instancia nueva de provider por fase (ver
// pipeline.service). Si el breaker viviera dentro del provider, cada fase
// tendría su propio contador y el backpressure nunca se acumularía. Estos
// singletons de módulo garantizan que el estado (abierto/cerrado) se comparte
// entre TODAS las instancias del mismo endpoint dentro del proceso.
//
// El breaker envuelve la llamada YA reintentada (`withRetries` del provider):
// primero se agotan los reintentos de una petición y solo entonces cuenta
// como un fallo del breaker. Tras N peticiones consecutivas fallidas, el
// circuito abre y las siguientes fallan rápido (backpressure) hasta que pasa
// `resetTimeout`. NO duplica el retry del provider: es una capa ortogonal.

import { CircuitBreaker } from "@/lib/infrastructure/circuit-breaker";
import { LLMProviderError } from "@/lib/domain/ai/llm-error";

/**
 * Un error cuenta como fallo de salud del endpoint (abre el circuito) solo si
 * es transitorio del lado del servicio: rate limit, error de servidor,
 * timeout o cuota agotada. `auth_error` e `invalid_response` NO abren el
 * circuito: esperar no los arregla (clave inválida / respuesta del modelo).
 */
function isEndpointHealthFailure(error: unknown): boolean {
  if (error instanceof LLMProviderError) {
    return (
      error.kind === "rate_limit" ||
      error.kind === "server_error" ||
      error.kind === "timeout" ||
      error.kind === "quota_exceeded"
    );
  }
  // Errores desconocidos (red caída, DNS, etc.) cuentan como fallo de salud.
  return true;
}

const OPENROUTER_BREAKER_OPTIONS = {
  // 5 peticiones consecutivas fallidas (cada una ya reintentada) abren el
  // circuito; se reintenta pasados 60s. Valores conservadores para no cortar
  // por un pico aislado pero sí frenar una caída sostenida del endpoint.
  failureThreshold: 5,
  resetTimeout: 60_000,
  isFailure: isEndpointHealthFailure,
} as const;

/** Breaker compartido para el endpoint de chat de OpenRouter. */
export const openRouterChatBreaker = new CircuitBreaker(OPENROUTER_BREAKER_OPTIONS);

/** Breaker compartido para el endpoint de embeddings de OpenRouter. */
export const openRouterEmbeddingBreaker = new CircuitBreaker(
  OPENROUTER_BREAKER_OPTIONS
);

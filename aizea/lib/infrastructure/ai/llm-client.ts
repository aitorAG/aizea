// llm-client — backwards-compatible facade over OpenRouterLLMProvider.
//
// Vivía en `lib/domain/llm/LLMClient.ts`. La Fase 1 (purificación del dominio)
// lo movió a infraestructura: es un shim que construye un provider concreto de
// OpenRouter y lo expone vía funciones libres (`chat`, `chatJSON`) para los
// consumidores de la capa de APLICACIÓN (SlideGenerationService, SlideService,
// TreeService), que SÍ pueden depender de infra.
//
// Los servicios de DOMINIO ya NO usan estas funciones libres: reciben
// `ILLMProvider` inyectado por el composition root.

import { OpenRouterLLMProvider } from "@/lib/infrastructure/ai/openrouter-llm.provider";
import type { ChatMessage, ChatOptions } from "@/lib/application/ports/llm-provider.port";

export type { ChatMessage, ChatOptions };

const _provider = new OpenRouterLLMProvider();

/** Send a chat request. Returns the raw text content. */
export async function chat(
  messages: ChatMessage[],
  options?: { json?: boolean }
): Promise<string> {
  return _provider.chat(messages, options);
}

/** Send a chat request and parse the response as JSON. */
export async function chatJSON<T>(messages: ChatMessage[]): Promise<T> {
  return _provider.chatJSON<T>(messages);
}

// Re-export the provider class for callers that want to construct one
// with custom options (e.g. different getApiKey / getModel injections).
export { OpenRouterLLMProvider };

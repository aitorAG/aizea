// LLMClient — backwards-compatible re-export over OpenRouterLLMProvider.
//
// The `chat` and `chatJSON` free functions remain exported so all existing
// callers (UnitExtractor, SlideService, tree actions, etc.) compile without
// change. Internally they delegate to a shared OpenRouterLLMProvider instance
// that uses the new ILLMProvider abstraction, typed errors, and unified
// retry policy.
//
// New code should inject ILLMProvider via the composition root instead of
// importing these free functions directly.

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

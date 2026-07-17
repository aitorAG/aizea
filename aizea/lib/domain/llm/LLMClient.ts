import { config } from "@/lib/config";
import { getApiKey, getChatModel } from "@/lib/config-service";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503]);

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

class OpenRouterHTTPError extends Error {
  constructor(public status: number, message: string) {
    super(`OpenRouter error (${status}): ${message}`);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  messages: ChatMessage[],
  options?: { json?: boolean }
): Promise<{ ok: true; content: string } | { ok: false; status: number; error: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  // Resolve apiKey and model from the dynamic config service. This reads from
  // the Settings DB row first, then env vars, then built-in defaults. The
  // static `config` import above is still consulted as a safety net for the
  // API key (in case the DB call fails AND the env var is also missing).
  const [apiKey, model] = await Promise.all([getApiKey(), getChatModel()]);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey || config.openrouter.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.4,
        max_tokens: 8000,
        response_format: options?.json ? { type: "json_object" } : undefined,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const err = await response.text();
      return { ok: false, status: response.status, error: err };
    }

    const data = await response.json();
    return { ok: true, content: data.choices[0].message.content as string };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenRouter request timed out after 120s");
    }

    throw error;
  }
}

export async function chat(
  messages: ChatMessage[],
  options?: { json?: boolean }
): Promise<string> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await fetchWithTimeout(messages, options);

      if (!result.ok) {
        if (RETRYABLE_STATUS_CODES.has(result.status) && attempt < MAX_RETRIES - 1) {
          await delay(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        throw new OpenRouterHTTPError(result.status, result.error);
      }

      return result.content;
    } catch (error) {
      if (error instanceof OpenRouterHTTPError) {
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

  throw new Error("OpenRouter request failed after max retries");
}

export async function chatJSON<T>(messages: ChatMessage[]): Promise<T> {
  const raw = await chat(messages, { json: true });
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}


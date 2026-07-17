// Config service — dynamic configuration with DB > env > defaults precedence.
//
// Source order (highest priority first):
//   1. Settings DB row (id="default") if it has a non-empty value for the field.
//   2. process.env (OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_EMBED_MODEL).
//   3. Built-in defaults (deepseek/deepseek-chat, openai/text-embedding-3-small).
//
// Caching:
//   - The Settings row is cached in-process for 30 seconds.
//   - Cache is bypassed if `bypassCache: true` is passed to `getSettings`.
//   - `invalidateConfigCache()` forces a refresh on the next call.
//
// This module NEVER throws on missing config — it always returns a usable
// value. The static guard in `lib/config.ts` is the import-time check that
// catches misconfigured deployments.

import { db } from "@/lib/db";

export const DEFAULT_CHAT_MODEL = "deepseek/deepseek-chat";
export const DEFAULT_EMBED_MODEL = "openai/text-embedding-3-small";
export const DEFAULT_DOCLING_BASE_URL = "http://127.0.0.1:5001";
export const DEFAULT_API_KEY_FALLBACK = "test-api-key";

/** TTL in milliseconds. */
export const CONFIG_CACHE_TTL_MS = 30_000;

export interface RuntimeSettings {
  apiKey: string;
  chatModel: string;
  embedModel: string;
  doclingBaseUrl: string;
  /** True if at least one field came from the DB row. */
  fromDb: boolean;
}

interface CacheEntry {
  value: RuntimeSettings;
  expiresAt: number;
}

let cache: CacheEntry | null = null;

function readEnvApiKey(): string {
  const v = process.env.OPENROUTER_API_KEY;
  return v && v.length > 0 ? v : DEFAULT_API_KEY_FALLBACK;
}

function readEnvChatModel(): string {
  const v = process.env.OPENROUTER_MODEL;
  return v && v.length > 0 ? v : DEFAULT_CHAT_MODEL;
}

function readEnvEmbedModel(): string {
  const v = process.env.OPENROUTER_EMBED_MODEL;
  return v && v.length > 0 ? v : DEFAULT_EMBED_MODEL;
}

function readEnvDoclingBaseUrl(): string {
  const v = process.env.DOCLING_BASE_URL;
  return v && v.length > 0 ? v : DEFAULT_DOCLING_BASE_URL;
}

/**
 * Read the Settings row from the database. Returns null if not present or on error.
 * Errors are swallowed (logged) so a transient DB blip doesn't take down LLM calls.
 */
async function readDbSettings(): Promise<{
  apiKey: string | null;
  chatModel: string;
  embedModel: string;
  doclingBaseUrl: string;
} | null> {
  try {
    const row = await db.settings.findUnique({ where: { id: "default" } });
    if (!row) return null;
    return {
      apiKey: row.openrouterApiKey ?? null,
      chatModel: row.chatModel,
      embedModel: row.embedModel,
      doclingBaseUrl: row.doclingBaseUrl,
    };
  } catch (err) {
    console.error("[config-service] DB read failed, falling back to env:", err);
    return null;
  }
}

/**
 * Resolve runtime settings. Uses a 30s in-memory cache; pass
 * `{ bypassCache: true }` to force a fresh DB read.
 */
export async function getSettings(
  options: { bypassCache?: boolean } = {}
): Promise<RuntimeSettings> {
  const now = Date.now();
  if (!options.bypassCache && cache && cache.expiresAt > now) {
    return cache.value;
  }

  const fromDbRow = await readDbSettings();

  const value: RuntimeSettings = {
    apiKey: fromDbRow?.apiKey && fromDbRow.apiKey.length > 0
      ? fromDbRow.apiKey
      : readEnvApiKey(),
    chatModel: fromDbRow?.chatModel && fromDbRow.chatModel.length > 0
      ? fromDbRow.chatModel
      : readEnvChatModel(),
    embedModel: fromDbRow?.embedModel && fromDbRow.embedModel.length > 0
      ? fromDbRow.embedModel
      : readEnvEmbedModel(),
    doclingBaseUrl:
      fromDbRow?.doclingBaseUrl && fromDbRow.doclingBaseUrl.length > 0
        ? fromDbRow.doclingBaseUrl
        : readEnvDoclingBaseUrl(),
    fromDb: fromDbRow !== null,
  };

  cache = { value, expiresAt: now + CONFIG_CACHE_TTL_MS };
  return value;
}

/** Convenience: returns just the API key, going through the same cache. */
export async function getApiKey(): Promise<string> {
  const s = await getSettings();
  return s.apiKey;
}

/** Convenience: returns just the chat model. */
export async function getChatModel(): Promise<string> {
  const s = await getSettings();
  return s.chatModel;
}

/** Convenience: returns just the embedding model. */
export async function getEmbedModel(): Promise<string> {
  const s = await getSettings();
  return s.embedModel;
}

/** Convenience: returns the docling-serve base URL. */
export async function getDoclingBaseUrl(): Promise<string> {
  const s = await getSettings();
  return s.doclingBaseUrl;
}

/**
 * Drop the cached settings. Call this after writing to the Settings table
 * so the next `getSettings()` reflects the new values immediately.
 */
export function invalidateConfigCache(): void {
  cache = null;
}

/**
 * Test-only: replace the in-memory cache directly. Avoids relying on TTL
 * timing in unit tests. NOT exported as a public API of the service.
 */
export function _setCacheForTesting(value: RuntimeSettings | null): void {
  if (value === null) {
    cache = null;
  } else {
    cache = { value, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS };
  }
}

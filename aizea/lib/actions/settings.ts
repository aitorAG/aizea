"use server";

// Server actions for the OpenRouter / LLM settings page.
// All access goes through the Settings Prisma row (singleton id="default")
// and invalidates the in-process config cache so the next LLM call sees
// the new values without waiting for the 30s TTL.

import { container } from "@/lib/composition/container";
import { invalidateConfigCache, getSettings } from "@/lib/config-service";
import { revalidatePath } from "next/cache";

export interface SettingsView {
  openrouterApiKey: string | null;
  chatModel: string;
  embedModel: string;
  doclingBaseUrl: string;
  /** True when the row is stored in the DB; false when it is purely the env/defaults. */
  persisted: boolean;
  /** True when at least one field is currently coming from a non-default source. */
  apiKeyPresent: boolean;
}

/** Read the current effective settings. Safe to call from server components. */
export async function getSettingsAction(): Promise<SettingsView> {
  const row = await container.settings.get();
  if (!row) {
    return {
      openrouterApiKey: null,
      chatModel: "deepseek/deepseek-chat",
      embedModel: "openai/text-embedding-3-small",
      doclingBaseUrl: "http://127.0.0.1:5001",
      persisted: false,
      apiKeyPresent: false,
    };
  }
  return {
    openrouterApiKey: row.openrouterApiKey,
    chatModel: row.chatModel,
    embedModel: row.embedModel,
    doclingBaseUrl: row.doclingBaseUrl,
    persisted: true,
    apiKeyPresent: row.openrouterApiKey !== null && row.openrouterApiKey.length > 0,
  };
}

export interface UpdateSettingsInput {
  apiKey?: string | null;
  chatModel?: string;
  embedModel?: string;
  doclingBaseUrl?: string;
}

export interface UpdateSettingsResult {
  ok: true;
  persisted: true;
}

export interface UpdateSettingsError {
  ok: false;
  error: string;
}

/**
 * Persist the supplied settings to the Settings row, then invalidate the
 * in-memory config cache so subsequent LLM calls see the new values.
 * Empty / null apiKey clears the DB field (falls back to env).
 */
export async function updateSettingsAction(
  input: UpdateSettingsInput
): Promise<UpdateSettingsResult | UpdateSettingsError> {
  const chatModel = (input.chatModel ?? "").trim();
  const embedModel = (input.embedModel ?? "").trim();
  const doclingBaseUrl = (input.doclingBaseUrl ?? "").trim();

  if (chatModel.length === 0) {
    return { ok: false, error: "Chat model no puede estar vacío." };
  }
  if (embedModel.length === 0) {
    return { ok: false, error: "Embed model no puede estar vacío." };
  }
  if (doclingBaseUrl.length === 0) {
    return { ok: false, error: "Docling base URL no puede estar vacía." };
  }
  // API key length check applies only when a non-empty value is provided.
  // Empty / null means "clear" and is handled below.
  if (
    typeof input.apiKey === "string" &&
    input.apiKey.trim().length > 0 &&
    input.apiKey.trim().length < 8
  ) {
    return {
      ok: false,
      error: "API key demasiado corta. OpenRouter keys empiezan por 'sk-or-v1-'.",
    };
  }

  const apiKey =
    input.apiKey === undefined
      ? undefined
      : input.apiKey === null || input.apiKey.trim().length === 0
        ? null
        : input.apiKey.trim();

  await container.settings.upsert({
    ...(apiKey !== undefined ? { openrouterApiKey: apiKey } : {}),
    chatModel,
    embedModel,
    doclingBaseUrl,
  });

  // Force the next config-service call to read the DB.
  invalidateConfigCache();
  revalidatePath("/settings");
  revalidatePath("/");

  return { ok: true, persisted: true };
}

export type TestConnectionResult =
  | {
      ok: true;
      /** The label OpenRouter reports for this key, when available. */
      label?: string;
    }
  | { ok: false; error: string };

/**
 * UX — "Probar conexión": validate the OpenRouter credentials BEFORE the
 * user kicks off an expensive pipeline and discovers the failure minutes
 * later. Uses OpenRouter's lightweight `/api/v1/key` endpoint (no LLM
 * tokens are spent).
 *
 * Pass `apiKey` to test a value the user has typed but not yet saved;
 * omit it (or pass empty) to test the currently persisted configuration.
 */
export async function testConnectionAction(
  apiKey?: string
): Promise<TestConnectionResult> {
  let key = apiKey?.trim() ?? "";
  if (key.length === 0) {
    try {
      const s = await getSettings();
      key = s.apiKey;
    } catch {
      return { ok: false, error: "No se pudo leer la configuración actual." };
    }
  }
  if (key.length === 0 || key === "test-api-key") {
    return {
      ok: false,
      error: "No hay ninguna API key configurada. Introduce tu clave de OpenRouter primero.",
    };
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      let label: string | undefined;
      try {
        const body = (await res.json()) as {
          data?: { label?: string };
        };
        label = body.data?.label ?? undefined;
      } catch {
        // Body parsing is best-effort — the key itself validated.
      }
      return { ok: true, label };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error:
          "La API key no es válida o fue revocada. Revisa que copies la clave completa (empieza por 'sk-or-v1-').",
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        error: "Has superado el límite de peticiones de OpenRouter. Espera unos segundos e inténtalo de nuevo.",
      };
    }
    return {
      ok: false,
      error: `OpenRouter respondió con un error inesperado (HTTP ${res.status}). Inténtalo de nuevo más tarde.`,
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `No se pudo conectar con OpenRouter: ${err.message}`
          : "No se pudo conectar con OpenRouter. Comprueba tu conexión a internet.",
    };
  }
}

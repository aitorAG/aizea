"use server";

// Server actions for the OpenRouter / LLM settings page.
// Reads effective runtime values from config-service and writes the Settings
// Prisma row (singleton id="default"). Writes invalidate the in-process cache.

import { container } from "@/lib/composition/container";
import {
  DEFAULT_API_KEY_FALLBACK,
  getSettings,
  invalidateConfigCache,
  DEFAULT_DOCLING_BASE_URL,
} from "@/lib/config-service";
import { revalidatePath } from "next/cache";

export interface SettingsView {
  openrouterApiKey: string | null;
  chatModel: string;
  embedModel: string;
  doclingBaseUrl: string;
  /** True when the row is stored in the DB; false when it is purely the env/defaults. */
  persisted: boolean;
  /** True when the effective API key is configured (excluding the internal placeholder). */
  apiKeyPresent: boolean;
}

/** Read the current effective settings. Safe to call from server components. */
export async function getSettingsAction(): Promise<SettingsView> {
  const [row, settings] = await Promise.all([
    container.settings.get(),
    getSettings({ bypassCache: true }),
  ]);
  return {
    // v0.14.0 — NUNCA enviar la key descifrada al cliente, aunque el
    // formulario no la muestre: viaja en el payload del server action. La UI
    // solo necesita `apiKeyPresent` para el estado "configurada".
    openrouterApiKey: null,
    chatModel: settings.chatModel,
    embedModel: settings.embedModel,
    doclingBaseUrl: settings.doclingBaseUrl,
    persisted: row !== null,
    apiKeyPresent:
      settings.apiKey.length > 0 && settings.apiKey !== DEFAULT_API_KEY_FALLBACK,
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

// ---------------------------------------------------------------------------
// v0.14.0 — Pre-flight "Probar conexión": valida la configuración ANTES de
// arrancar un pipeline largo, para que una key/docling mal configurados se
// descubran en Settings y no a mitad del proceso.
// ---------------------------------------------------------------------------

export interface ConnectionCheckResult {
  ok: boolean;
  /** Mensaje accionable para mostrar en la UI. */
  message: string;
}

export interface ConnectionTestResult {
  openRouter: ConnectionCheckResult;
  docling: ConnectionCheckResult;
}

const OPENROUTER_KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";

async function checkOpenRouter(): Promise<ConnectionCheckResult> {
  const settings = await getSettings({ bypassCache: true });
  const apiKey = settings.apiKey;

  if (!apiKey || apiKey === DEFAULT_API_KEY_FALLBACK) {
    return {
      ok: false,
      message: "No hay API key configurada. Pega tu key de OpenRouter arriba.",
    };
  }

  try {
    const res = await fetch(OPENROUTER_KEY_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.ok) {
      return { ok: true, message: "API key válida." };
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        message: "La API key es inválida o fue revocada (HTTP " + res.status + ").",
      };
    }
    return {
      ok: false,
      message: `OpenRouter respondió HTTP ${res.status}. Revisa el estado del servicio.`,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        "No se pudo contactar con OpenRouter: " +
        (err instanceof Error ? err.message : String(err)),
    };
  }
}

async function checkDocling(baseUrl: string): Promise<ConnectionCheckResult> {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(`${normalized}/health`);
  } catch {
    return { ok: false, message: `URL inválida: "${baseUrl}"` };
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (res.ok) {
      return { ok: true, message: "docling-serve accesible." };
    }
    return {
      ok: false,
      message: `docling-serve respondió HTTP ${res.status} en ${normalized}.`,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        `docling-serve no accesible en ${normalized}. ¿Está arrancado? ` +
        "(npm run docling:up) — detalle: " +
        (err instanceof Error ? err.message : String(err)),
    };
  }
}

/**
 * Prueba la conectividad con OpenRouter (validez de la API key) y con
 * docling-serve (health check). NUNCA lanza: siempre devuelve un resultado
 * estructurado por servicio.
 *
 * @param doclingBaseUrlOverride URL alternativa a probar (p. ej. el valor
 *        que el usuario acaba de escribir en el formulario y aún no guardó).
 */
export async function testConnectionAction(
  doclingBaseUrlOverride?: string
): Promise<ConnectionTestResult> {
  const [openRouter, docling] = await Promise.all([
    checkOpenRouter(),
    (async () => {
      const base =
        doclingBaseUrlOverride && doclingBaseUrlOverride.trim().length > 0
          ? doclingBaseUrlOverride
          : await getDoclingBaseUrlSafe();
      return checkDocling(base);
    })(),
  ]);
  return { openRouter, docling };
}

async function getDoclingBaseUrlSafe(): Promise<string> {
  try {
    const { getSettings } = await import("@/lib/config-service");
    return (await getSettings()).doclingBaseUrl;
  } catch {
    return DEFAULT_DOCLING_BASE_URL;
  }
}

// Centralized application configuration.
//
// The previous import-time throw on missing OPENROUTER_API_KEY has been
// removed. Desktop (.exe/.msi) users start the app without a key and
// configure it in /settings. The LLM provider throws LLMProviderError
// at call time when the key is absent, which surfaces a clear error in
// the UI.

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey && process.env.NODE_ENV !== "test") {
  console.warn(
    "[config] OPENROUTER_API_KEY is not set. LLM features will not work " +
      "until an API key is configured in /settings."
  );
}

const model = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat";
const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
// 250 MB en bytes. Mantener en sincronia con next.config.ts (bodySizeLimit).
const bodySizeLimit = 262144000;

export interface AppConfig {
  openrouter: {
    apiKey: string | undefined;
    model: string;
  };
  database: {
    url: string;
  };
  upload: {
    bodySizeLimit: number;
  };
}

export const config: AppConfig = {
  openrouter: {
    apiKey,
    model,
  },
  database: {
    url: databaseUrl,
  },
  upload: {
    bodySizeLimit,
  },
};

// Re-export the dynamic config service so callers can opt in to runtime
// overrides stored in the Settings table. The static `config` above remains
// the import-time guardrail.
export {
  getSettings as getDynamicConfig,
  getApiKey,
  getChatModel,
  getEmbedModel,
  getDoclingBaseUrl,
  invalidateConfigCache,
} from "@/lib/config-service";

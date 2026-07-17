// Centralized application configuration.
// Validates required environment variables at import time (early-fail).

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error(
    "OPENROUTER_API_KEY no configurada. Define OPENROUTER_API_KEY en .env o en el entorno de ejecucion."
  );
}

const model = process.env.OPENROUTER_MODEL ?? "deepseek/deepseek-chat";
const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
// 250 MB en bytes. Mantener en sincronia con next.config.ts (bodySizeLimit).
const bodySizeLimit = 262144000;

export interface AppConfig {
  openrouter: {
    apiKey: string;
    model: string;
  };
  database: {
    url: string;
  };
  redis: {
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
  redis: {
    url: redisUrl,
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

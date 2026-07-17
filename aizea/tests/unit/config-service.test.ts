import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

// ---- Test DB setup (apply schema BEFORE app code loads) ----
const TEST_DB = join(process.cwd(), "prisma", "test-config-service.db");
const TEST_DB_URL = `file:${TEST_DB}`;
const MIGRATION_SQL = join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260711161501_add_pipeline_tables",
  "migration.sql"
);

for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
}
process.env.DATABASE_URL = TEST_DB_URL;

const testDb = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });

// Apply schema (top-level await is fine inside an ESM module).
const sql = readFileSync(MIGRATION_SQL, "utf-8");
const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.replace(/^--.*$/gm, "").trim())
  .filter((s) => s.length > 0);
for (const stmt of statements) {
  await testDb.$executeRawUnsafe(stmt);
}

// Mock @/lib/db with our test instance so config-service reads/writes the test DB.
vi.mock("@/lib/db", () => ({ db: testDb }));

const ORIGINAL_ENV = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPENROUTER_EMBED_MODEL: process.env.OPENROUTER_EMBED_MODEL,
  DOCLING_BASE_URL: process.env.DOCLING_BASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
};

let getSettings: typeof import("@/lib/config-service").getSettings;
let getApiKey: typeof import("@/lib/config-service").getApiKey;
let getChatModel: typeof import("@/lib/config-service").getChatModel;
let getEmbedModel: typeof import("@/lib/config-service").getEmbedModel;
let getDoclingBaseUrl: typeof import("@/lib/config-service").getDoclingBaseUrl;
let invalidateConfigCache: typeof import("@/lib/config-service").invalidateConfigCache;
let _setCacheForTesting: typeof import("@/lib/config-service")._setCacheForTesting;
let DEFAULT_CHAT_MODEL: string;
let DEFAULT_EMBED_MODEL: string;

beforeAll(async () => {
  const mod = await import("@/lib/config-service");
  getSettings = mod.getSettings;
  getApiKey = mod.getApiKey;
  getChatModel = mod.getChatModel;
  getEmbedModel = mod.getEmbedModel;
  getDoclingBaseUrl = mod.getDoclingBaseUrl;
  invalidateConfigCache = mod.invalidateConfigCache;
  _setCacheForTesting = mod._setCacheForTesting;
  DEFAULT_CHAT_MODEL = mod.DEFAULT_CHAT_MODEL;
  DEFAULT_EMBED_MODEL = mod.DEFAULT_EMBED_MODEL;
});

afterAll(async () => {
  await testDb.$disconnect();
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
  }
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_EMBED_MODEL;
  delete process.env.DOCLING_BASE_URL;
  await testDb.settings.deleteMany({});
  invalidateConfigCache();
});

afterEach(() => {
  invalidateConfigCache();
});

describe("config-service: precedence DB > env > defaults", () => {
  it("returns defaults when DB is empty and env is empty", async () => {
    const s = await getSettings({ bypassCache: true });
    expect(s.apiKey).toBe("test-api-key");
    expect(s.chatModel).toBe(DEFAULT_CHAT_MODEL);
    expect(s.embedModel).toBe(DEFAULT_EMBED_MODEL);
    expect(s.doclingBaseUrl).toBe("http://127.0.0.1:5001");
    expect(s.fromDb).toBe(false);
  });

  it("uses env vars when DB is empty", async () => {
    process.env.OPENROUTER_API_KEY = "sk-env-123";
    process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
    process.env.OPENROUTER_EMBED_MODEL = "voyage/voyage-3";
    const s = await getSettings({ bypassCache: true });
    expect(s.apiKey).toBe("sk-env-123");
    expect(s.chatModel).toBe("anthropic/claude-3.5-sonnet");
    expect(s.embedModel).toBe("voyage/voyage-3");
    expect(s.fromDb).toBe(false);
  });

  it("DB overrides env when DB row has values", async () => {
    process.env.OPENROUTER_API_KEY = "sk-env-123";
    process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
    process.env.OPENROUTER_EMBED_MODEL = "voyage/voyage-3";
    await testDb.settings.create({
      data: {
        id: "default",
        openrouterApiKey: "sk-db-999",
        chatModel: "deepseek/deepseek-v3",
        embedModel: "openai/text-embedding-3-large",
        doclingBaseUrl: "http://db-host:5001",
      },
    });
    const s = await getSettings({ bypassCache: true });
    expect(s.apiKey).toBe("sk-db-999");
    expect(s.chatModel).toBe("deepseek/deepseek-v3");
    expect(s.embedModel).toBe("openai/text-embedding-3-large");
    expect(s.doclingBaseUrl).toBe("http://db-host:5001");
    expect(s.fromDb).toBe(true);
  });

  it("DB with null apiKey falls back to env for that field", async () => {
    process.env.OPENROUTER_API_KEY = "sk-env-only";
    await testDb.settings.create({
      data: {
        id: "default",
        openrouterApiKey: null,
        chatModel: "deepseek/deepseek-v3",
        embedModel: "openai/text-embedding-3-small",
        doclingBaseUrl: "http://127.0.0.1:5001",
      },
    });
    const s = await getSettings({ bypassCache: true });
    expect(s.apiKey).toBe("sk-env-only");
    expect(s.chatModel).toBe("deepseek/deepseek-v3");
    expect(s.fromDb).toBe(true);
  });
});

describe("config-service: helpers", () => {
  it("getApiKey returns the api key from getSettings", async () => {
    process.env.OPENROUTER_API_KEY = "sk-helper-test";
    expect(await getApiKey()).toBe("sk-helper-test");
  });

  it("getChatModel returns the chat model from getSettings", async () => {
    await testDb.settings.create({
      data: { id: "default", chatModel: "gpt-4o" },
    });
    expect(await getChatModel()).toBe("gpt-4o");
  });

  it("getEmbedModel returns the embed model from getSettings", async () => {
    process.env.OPENROUTER_EMBED_MODEL = "voyage-large";
    expect(await getEmbedModel()).toBe("voyage-large");
  });

  it("getDoclingBaseUrl returns the docling URL from getSettings", async () => {
    process.env.DOCLING_BASE_URL = "http://custom:9999";
    expect(await getDoclingBaseUrl()).toBe("http://custom:9999");
  });
});

describe("config-service: 30s cache", () => {
  it("caches result within TTL (no repeated DB reads)", async () => {
    process.env.OPENROUTER_API_KEY = "sk-cache-1";
    const s1 = await getSettings();
    expect(s1.apiKey).toBe("sk-cache-1");
    process.env.OPENROUTER_API_KEY = "sk-cache-1-changed";
    const s2 = await getSettings();
    expect(s2.apiKey).toBe("sk-cache-1");
  });

  it("invalidates cache when invalidateConfigCache() is called", async () => {
    process.env.OPENROUTER_API_KEY = "sk-cache-2";
    const s1 = await getSettings();
    expect(s1.apiKey).toBe("sk-cache-2");

    await testDb.settings.create({
      data: { id: "default", openrouterApiKey: "sk-cache-2-updated" },
    });

    const s2 = await getSettings();
    expect(s2.apiKey).toBe("sk-cache-2");

    invalidateConfigCache();
    const s3 = await getSettings();
    expect(s3.apiKey).toBe("sk-cache-2-updated");
  });

  it("bypassCache:true forces a fresh read", async () => {
    process.env.OPENROUTER_API_KEY = "sk-bypass";
    const s1 = await getSettings();
    expect(s1.apiKey).toBe("sk-bypass");

    process.env.OPENROUTER_API_KEY = "sk-bypass-2";
    const s2 = await getSettings({ bypassCache: true });
    expect(s2.apiKey).toBe("sk-bypass-2");
  });

  it("_setCacheForTesting replaces cache directly (test hook)", async () => {
    _setCacheForTesting({
      apiKey: "sk-forced",
      chatModel: "gpt-4o-mini",
      embedModel: "text-embed",
      doclingBaseUrl: "http://forced:5001",
      fromDb: true,
    });
    const s = await getSettings();
    expect(s.apiKey).toBe("sk-forced");
    expect(s.chatModel).toBe("gpt-4o-mini");
    _setCacheForTesting(null);
  });
});

describe("config-service: error resilience", () => {
  it("does not throw when DB read errors (falls back to env/defaults)", async () => {
    const spy = vi
      .spyOn(testDb.settings, "findUnique")
      .mockRejectedValue(new Error("db down"));
    process.env.OPENROUTER_API_KEY = "sk-resilient";
    const s = await getSettings({ bypassCache: true });
    expect(s.apiKey).toBe("sk-resilient");
    expect(s.fromDb).toBe(false);
    spy.mockRestore();
  });
});

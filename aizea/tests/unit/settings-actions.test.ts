import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { isEncrypted, decryptSecret } from "@/lib/infrastructure/crypto/secret-cipher";

const TEST_DB = join(process.cwd(), "prisma", "test-settings-actions.db");
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
const sql = readFileSync(MIGRATION_SQL, "utf-8");
const statements = sql
  .split(/;\s*\n/)
  .map((s) => s.replace(/^--.*$/gm, "").trim())
  .filter((s) => s.length > 0);
for (const stmt of statements) {
  await testDb.$executeRawUnsafe(stmt);
}

vi.mock("@/lib/db", () => ({ db: testDb }));

// Mock the Next.js revalidatePath server function to no-op so we don't
// need a running Next.js request context.
vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

let getSettingsAction: typeof import("@/lib/actions/settings").getSettingsAction;
let updateSettingsAction: typeof import("@/lib/actions/settings").updateSettingsAction;
let invalidateConfigCache: typeof import("@/lib/config-service").invalidateConfigCache;
let _setCacheForTesting: typeof import("@/lib/config-service")._setCacheForTesting;
const originalEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
  OPENROUTER_EMBED_MODEL: process.env.OPENROUTER_EMBED_MODEL,
  DOCLING_BASE_URL: process.env.DOCLING_BASE_URL,
};

beforeAll(async () => {
  const settingsMod = await import("@/lib/actions/settings");
  getSettingsAction = settingsMod.getSettingsAction;
  updateSettingsAction = settingsMod.updateSettingsAction;
  const cfgMod = await import("@/lib/config-service");
  invalidateConfigCache = cfgMod.invalidateConfigCache;
  _setCacheForTesting = cfgMod._setCacheForTesting;
});

afterAll(async () => {
  await testDb.$disconnect();
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_MODEL;
  delete process.env.OPENROUTER_EMBED_MODEL;
  delete process.env.DOCLING_BASE_URL;
  await testDb.settings.deleteMany({});
  invalidateConfigCache();
  _setCacheForTesting(null);
});

describe("getSettingsAction", () => {
  it("uses effective env settings without a DB row and never serializes the key", async () => {
    const secret = "sk-env-secret-123456";
    process.env.OPENROUTER_API_KEY = secret;
    process.env.OPENROUTER_MODEL = "env/chat";
    process.env.OPENROUTER_EMBED_MODEL = "env/embed";
    process.env.DOCLING_BASE_URL = "http://env-docling:9999";
    _setCacheForTesting({
      apiKey: "test-api-key",
      chatModel: "stale/chat",
      embedModel: "stale/embed",
      doclingBaseUrl: "http://stale:5001",
      fromDb: false,
    });

    const result = await getSettingsAction();
    expect(result).toEqual({
      openrouterApiKey: null,
      chatModel: "env/chat",
      embedModel: "env/embed",
      doclingBaseUrl: "http://env-docling:9999",
      persisted: false,
      apiKeyPresent: true,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("returns defaults when no row exists", async () => {
    const result = await getSettingsAction();
    expect(result.persisted).toBe(false);
    expect(result.openrouterApiKey).toBeNull();
    expect(result.chatModel).toBe("deepseek/deepseek-chat");
    expect(result.embedModel).toBe("openai/text-embedding-3-small");
    expect(result.doclingBaseUrl).toBe("http://127.0.0.1:5001");
    expect(result.apiKeyPresent).toBe(false);
  });

  it("returns stored values when a row exists", async () => {
    await testDb.settings.create({
      data: {
        id: "default",
        openrouterApiKey: "sk-stored",
        chatModel: "anthropic/claude-3.5-sonnet",
        embedModel: "voyage/voyage-3",
        doclingBaseUrl: "http://my-docling:5001",
      },
    });
    const result = await getSettingsAction();
    expect(result.persisted).toBe(true);
    // v0.14.0 — la key NUNCA se envía al cliente, aunque exista en BD.
    expect(result.openrouterApiKey).toBeNull();
    expect(result.chatModel).toBe("anthropic/claude-3.5-sonnet");
    expect(result.embedModel).toBe("voyage/voyage-3");
    expect(result.doclingBaseUrl).toBe("http://my-docling:5001");
    expect(result.apiKeyPresent).toBe(true);
  });

  it("apiKeyPresent is false when row has null apiKey", async () => {
    await testDb.settings.create({
      data: {
        id: "default",
        openrouterApiKey: null,
      },
    });
    const result = await getSettingsAction();
    expect(result.persisted).toBe(true);
    expect(result.apiKeyPresent).toBe(false);
  });

  it("uses DB overrides and never exposes the DB or env key", async () => {
    process.env.OPENROUTER_API_KEY = "sk-env-secret";
    process.env.OPENROUTER_MODEL = "env/chat";
    await testDb.settings.create({
      data: {
        id: "default",
        openrouterApiKey: "sk-db-secret",
        chatModel: "db/chat",
        embedModel: "db/embed",
        doclingBaseUrl: "http://db-docling:5001",
      },
    });

    const result = await getSettingsAction();
    expect(result).toEqual({
      openrouterApiKey: null,
      chatModel: "db/chat",
      embedModel: "db/embed",
      doclingBaseUrl: "http://db-docling:5001",
      persisted: true,
      apiKeyPresent: true,
    });
    expect(JSON.stringify(result)).not.toMatch(/sk-(db|env)-secret/);
  });

  it("clearing a DB key falls back to the env key while retaining the row", async () => {
    process.env.OPENROUTER_API_KEY = "sk-env-after-clear";
    await testDb.settings.create({
      data: { id: "default", openrouterApiKey: "sk-to-clear" },
    });
    await updateSettingsAction({
      apiKey: "",
      chatModel: "db/chat",
      embedModel: "db/embed",
      doclingBaseUrl: "http://db-docling:5001",
    });

    const result = await getSettingsAction();
    expect(result.persisted).toBe(true);
    expect(result.apiKeyPresent).toBe(true);
    expect(result.openrouterApiKey).toBeNull();
    expect(JSON.stringify(result)).not.toContain("sk-env-after-clear");
    expect((await testDb.settings.findUnique({ where: { id: "default" } }))?.openrouterApiKey).toBeNull();
  });

  it("treats the internal placeholder as an absent key", async () => {
    process.env.OPENROUTER_API_KEY = "test-api-key";
    const result = await getSettingsAction();
    expect(result.apiKeyPresent).toBe(false);
    expect(result.openrouterApiKey).toBeNull();
  });
});

describe("updateSettingsAction", () => {
  it("creates a new Settings row when none exists", async () => {
    const result = await updateSettingsAction({
      apiKey: "sk-new-1234567",
      chatModel: "gpt-4o",
      embedModel: "text-embedding-3-large",
      doclingBaseUrl: "http://localhost:5001",
    });
    expect(result.ok).toBe(true);
    const row = await testDb.settings.findUnique({ where: { id: "default" } });
    // Fase 5-A: the key is stored ENCRYPTED at rest — the raw DB value is an
    // envelope, and it decrypts back to the plaintext the user entered.
    expect(row?.openrouterApiKey).not.toBe("sk-new-1234567");
    expect(isEncrypted(row!.openrouterApiKey!)).toBe(true);
    expect(decryptSecret(row!.openrouterApiKey!)).toBe("sk-new-1234567");
    expect(row?.chatModel).toBe("gpt-4o");
    expect(row?.embedModel).toBe("text-embedding-3-large");
  });

  it("updates an existing row without overwriting the apiKey when not provided", async () => {
    await testDb.settings.create({
      data: {
        id: "default",
        openrouterApiKey: "sk-keep",
        chatModel: "old-model",
        embedModel: "old-embed",
      },
    });
    const result = await updateSettingsAction({
      chatModel: "new-model",
      embedModel: "new-embed",
      doclingBaseUrl: "http://new:5001",
    });
    expect(result.ok).toBe(true);
    const row = await testDb.settings.findUnique({ where: { id: "default" } });
    expect(row?.openrouterApiKey).toBe("sk-keep");
    expect(row?.chatModel).toBe("new-model");
    expect(row?.embedModel).toBe("new-embed");
  });

  it("clears the apiKey when an empty string is provided", async () => {
    await testDb.settings.create({
      data: {
        id: "default",
        openrouterApiKey: "sk-to-clear",
      },
    });
    const result = await updateSettingsAction({
      apiKey: "",
      chatModel: "x",
      embedModel: "y",
      doclingBaseUrl: "http://z:5001",
    });
    expect(result.ok).toBe(true);
    const row = await testDb.settings.findUnique({ where: { id: "default" } });
    expect(row?.openrouterApiKey).toBeNull();
  });

  it("trims whitespace from the apiKey", async () => {
    const result = await updateSettingsAction({
      apiKey: "  sk-padded  ",
      chatModel: "x",
      embedModel: "y",
      doclingBaseUrl: "http://z:5001",
    });
    expect(result.ok).toBe(true);
    const row = await testDb.settings.findUnique({ where: { id: "default" } });
    // Fase 5-A: stored encrypted; the decrypted value is the trimmed key.
    expect(isEncrypted(row!.openrouterApiKey!)).toBe(true);
    expect(decryptSecret(row!.openrouterApiKey!)).toBe("sk-padded");
  });

  it("rejects an empty chat model", async () => {
    const result = await updateSettingsAction({
      apiKey: "sk-1234567",
      chatModel: "  ",
      embedModel: "x",
      doclingBaseUrl: "http://x:5001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/chat model/i);
    }
  });

  it("rejects an empty embed model", async () => {
    const result = await updateSettingsAction({
      chatModel: "x",
      embedModel: "",
      doclingBaseUrl: "http://x:5001",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an empty doclingBaseUrl", async () => {
    const result = await updateSettingsAction({
      chatModel: "x",
      embedModel: "y",
      doclingBaseUrl: "",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects an apiKey that is too short", async () => {
    const result = await updateSettingsAction({
      apiKey: "short",
      chatModel: "x",
      embedModel: "y",
      doclingBaseUrl: "http://z:5001",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/API key/i);
    }
  });

  it("invalidates the in-memory cache after a successful update", async () => {
    _setCacheForTesting({
      apiKey: "sk-old",
      chatModel: "old",
      embedModel: "old",
      doclingBaseUrl: "http://old:5001",
      fromDb: true,
    });
    expect((await import("@/lib/config-service").then((m) => m.getSettings())).apiKey).toBe("sk-old");
    await updateSettingsAction({
      apiKey: "sk-new-1234567",
      chatModel: "new",
      embedModel: "new",
      doclingBaseUrl: "http://new:5001",
    });
    // After invalidation, next read should reflect the new DB values.
    const s = await (await import("@/lib/config-service")).getSettings({ bypassCache: false });
    expect(s.apiKey).toBe("sk-new-1234567");
    expect(s.chatModel).toBe("new");
  });
});

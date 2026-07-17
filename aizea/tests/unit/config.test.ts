import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("config", () => {
  const ORIGINAL = {
    apiKey: process.env.OPENROUTER_API_KEY,
    model: process.env.OPENROUTER_MODEL,
    db: process.env.DATABASE_URL,
  };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(ORIGINAL)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("loads typed config when OPENROUTER_API_KEY is set", async () => {
    process.env.OPENROUTER_API_KEY = "test-key-123";
    const { config } = await import("@/lib/config");
    expect(config.openrouter.apiKey).toBe("test-key-123");
    expect(config.openrouter.model).toBe("deepseek/deepseek-chat");
    expect(config.database.url).toBe("file:./dev.db");
    expect(config.upload.bodySizeLimit).toBe(262144000);
  });

  it("uses OPENROUTER_MODEL env override when provided", async () => {
    process.env.OPENROUTER_API_KEY = "test-key-123";
    process.env.OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
    const { config } = await import("@/lib/config");
    expect(config.openrouter.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("uses DATABASE_URL env override when provided", async () => {
    process.env.OPENROUTER_API_KEY = "test-key-123";
    process.env.DATABASE_URL = "file:/tmp/prod.db";
    const { config } = await import("@/lib/config");
    expect(config.database.url).toBe("file:/tmp/prod.db");
  });

  it("throws a descriptive error when OPENROUTER_API_KEY is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(import("@/lib/config")).rejects.toThrow(/OPENROUTER_API_KEY/);
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the config service so EmbeddingService does NOT hit the real database.
// The two tests at the bottom re-mock the relevant function on a per-test basis.
vi.mock("@/lib/config-service", () => ({
  getApiKey: vi.fn(async () => "test-api-key"),
  getChatModel: vi.fn(async () => "deepseek/deepseek-chat"),
  getEmbedModel: vi.fn(async () => "openai/text-embedding-3-small"),
  getSettings: vi.fn(async () => ({
    apiKey: "test-api-key",
    chatModel: "deepseek/deepseek-chat",
    embedModel: "openai/text-embedding-3-small",
    doclingBaseUrl: "http://127.0.0.1:5001",
    fromDb: false,
  })),
  invalidateConfigCache: vi.fn(),
  _setCacheForTesting: vi.fn(),
  DEFAULT_CHAT_MODEL: "deepseek/deepseek-chat",
  DEFAULT_EMBED_MODEL: "openai/text-embedding-3-small",
  DEFAULT_DOCLING_BASE_URL: "http://127.0.0.1:5001",
  DEFAULT_API_KEY_FALLBACK: "test-api-key",
  CONFIG_CACHE_TTL_MS: 30_000,
}));

describe("EmbeddingService — dummy mode (no real api key)", () => {
  const ORIGINAL_API_KEY = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    process.env.OPENROUTER_API_KEY = "test-api-key"; // sentinel = dummy mode
  });

  afterEach(() => {
    if (ORIGINAL_API_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = ORIGINAL_API_KEY;
  });

  it("embed() returns a deterministic dummy vector in dummy mode", async () => {
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    const svc = new EmbeddingService();
    const v1 = await svc.embed("hello");
    const v2 = await svc.embed("hello");
    expect(v1).toEqual(v2); // deterministic
    expect(v1).toHaveLength(1536);
  });

  it("dummy vectors differ across inputs", async () => {
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    const svc = new EmbeddingService();
    const v1 = await svc.embed("hello");
    const v2 = await svc.embed("world");
    expect(v1).not.toEqual(v2);
  });

  it("embedBatch() returns one dummy vector per text in dummy mode", async () => {
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    const svc = new EmbeddingService();
    const v = await svc.embedBatch(["a", "b", "c"]);
    expect(v).toHaveLength(3);
    expect(v[0]).toHaveLength(1536);
  });

  it("does not call fetch in dummy mode", async () => {
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    global.fetch = vi.fn();
    const svc = new EmbeddingService();
    await svc.embed("x");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("supports a custom dimension", async () => {
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    const svc = new EmbeddingService({ dimension: 8 });
    const v = await svc.embed("hi");
    expect(v).toHaveLength(8);
  });
});

describe("EmbeddingService — uses config-service model and apiKey", () => {
  const ORIGINAL_API_KEY = process.env.OPENROUTER_API_KEY;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    process.env.OPENROUTER_API_KEY = "sk-real-key-12345678";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    if (ORIGINAL_API_KEY === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = ORIGINAL_API_KEY;
  });

  it("sends the model from config-service in the request body", async () => {
    const cfgMod = await import("@/lib/config-service");
    vi.mocked(cfgMod.getApiKey).mockResolvedValue("sk-real-key-12345678");
    vi.mocked(cfgMod.getEmbedModel).mockResolvedValue("voyage/voyage-3");
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
      text: async () => "",
    })) as unknown as typeof fetch;
    const svc = new EmbeddingService();
    await svc.embed("hello");
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("voyage/voyage-3");
  });

  it("sends the apiKey from config-service in Authorization header", async () => {
    const cfgMod = await import("@/lib/config-service");
    vi.mocked(cfgMod.getApiKey).mockResolvedValue("sk-from-config-service-2");
    vi.mocked(cfgMod.getEmbedModel).mockResolvedValue("openai/text-embedding-3-small");
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
      text: async () => "",
    })) as unknown as typeof fetch;
    const svc = new EmbeddingService();
    await svc.embed("hi");
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const headers = (init!.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-from-config-service-2");
  });

  it("embedBatch returns one entry per input text", async () => {
    const cfgMod = await import("@/lib/config-service");
    vi.mocked(cfgMod.getApiKey).mockResolvedValue("sk-real-key-12345678");
    vi.mocked(cfgMod.getEmbedModel).mockResolvedValue("openai/text-embedding-3-small");
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] },
        ],
      }),
      text: async () => "",
    })) as unknown as typeof fetch;
    const svc = new EmbeddingService();
    const out = await svc.embedBatch(["foo", "bar"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual([0.1, 0.2, 0.3]);
    expect(out[1]).toEqual([0.4, 0.5, 0.6]);
  });

  it("retries on 429 then succeeds", async () => {
    vi.useRealTimers();
    const cfgMod = await import("@/lib/config-service");
    vi.mocked(cfgMod.getApiKey).mockResolvedValue("sk-real-key-12345678");
    vi.mocked(cfgMod.getEmbedModel).mockResolvedValue("openai/text-embedding-3-small");
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    let call = 0;
    global.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          json: async () => ({}),
          text: async () => "rate limited",
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ data: [{ embedding: [1, 2, 3] }] }),
        text: async () => "",
      };
    }) as unknown as typeof fetch;
    const svc = new EmbeddingService();
    const out = await svc.embed("retry");
    expect(out).toEqual([1, 2, 3]);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws after max retries on persistent 429", async () => {
    // Switch to real timers for this test so the rejection from
    // fetchEmbeddings is observed by the test (no orphan microtask).
    vi.useRealTimers();
    const cfgMod = await import("@/lib/config-service");
    vi.mocked(cfgMod.getApiKey).mockResolvedValue("sk-real-key-12345678");
    vi.mocked(cfgMod.getEmbedModel).mockResolvedValue("openai/text-embedding-3-small");
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 429,
      headers: { get: () => null },
      json: async () => ({}),
      text: async () => "still rate limited",
    })) as unknown as typeof fetch;
    const svc = new EmbeddingService();
    // LLMProviderError message: "OpenRouter embeddings error (429): still rate limited"
    await expect(svc.embed("doomed")).rejects.toThrow(/429/);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("constructor model override beats config-service", async () => {
    const cfgMod = await import("@/lib/config-service");
    vi.mocked(cfgMod.getApiKey).mockResolvedValue("sk-real-key-12345678");
    vi.mocked(cfgMod.getEmbedModel).mockResolvedValue("openai/text-embedding-3-small");
    const { EmbeddingService } = await import("@/lib/domain/rag/EmbeddingService");
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ embedding: [0] }] }),
      text: async () => "",
    })) as unknown as typeof fetch;
    const svc = new EmbeddingService({ model: "explicit-override-model" });
    await svc.embed("x");
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("explicit-override-model");
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the config service so LLMClient does NOT hit the real database during
// these tests. The tests only care about how LLMClient uses apiKey + model
// in the request body, not about how config-service resolves them.
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

// Ensure OPENROUTER_API_KEY is set before any dynamic imports of config
describe("LLMClient", () => {
  const originalFetch = global.fetch;
  const ORIGINAL_API_KEY = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    process.env.OPENROUTER_API_KEY = "test-api-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    if (ORIGINAL_API_KEY === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = ORIGINAL_API_KEY;
    }
  });

  function mockFetchSequence(
    ...responses: Array<{
      ok: boolean;
      status: number;
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
    }>
  ) {
    let callIndex = 0;
    global.fetch = vi.fn(async () => {
      const res = responses[callIndex++];
      if (!res) {
        throw new Error("Unexpected fetch call");
      }
      return {
        ok: res.ok,
        status: res.status,
        json: res.json ?? (async () => ""),
        text: res.text ?? (async () => ""),
      } as Response;
    });
  }

  const sampleMessages = [
    { role: "user" as const, content: "Hello" },
  ];

  it("returns content on successful fetch", async () => {
    const { chat } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "Hello back" } }],
      }),
    });

    const result = await chat(sampleMessages);
    expect(result).toBe("Hello back");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 429 and succeeds on second attempt", async () => {
    const { chat } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence(
      {
        ok: false,
        status: 429,
        text: async () => "Rate limited",
      },
      {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Success after retry" } }],
        }),
      }
    );

    const promise = chat(sampleMessages);
    // Advance timers for the 1s retry delay
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await promise;

    expect(result).toBe("Success after retry");
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 500, 502, 503 with exponential backoff", async () => {
    const { chat } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence(
      { ok: false, status: 500, text: async () => "Server Error" },
      { ok: false, status: 502, text: async () => "Bad Gateway" },
      {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "Finally OK" } }],
        }),
      }
    );

    const promise = chat(sampleMessages);
    // Advance through delays: 1s + 2s = 3s
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    const result = await promise;

    expect(result).toBe("Finally OK");
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("does not retry on non-retryable errors (e.g. 400)", async () => {
    const { chat } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    });

    await expect(chat(sampleMessages)).rejects.toThrow(/OpenRouter error \(400\)/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries exhausted", async () => {
    const { chat } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence(
      { ok: false, status: 429, text: async () => "Rate limited" },
      { ok: false, status: 429, text: async () => "Rate limited" },
      { ok: false, status: 429, text: async () => "Rate limited" }
    );

    const promise = chat(sampleMessages);
    const timerPromise = vi.advanceTimersByTimeAsync(1_000).then(() =>
      vi.advanceTimersByTimeAsync(2_000)
    );
    const [, chatResult] = await Promise.allSettled([timerPromise, promise]);

    expect(chatResult.status).toBe("rejected");
    if (chatResult.status === "rejected") {
      expect(chatResult.reason.message).toMatch(/OpenRouter error \(429\)/);
    }
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it("throws timeout error when fetch exceeds 120s", async () => {
    const { chat } = await import("@/lib/domain/llm/LLMClient");
    global.fetch = vi.fn((_url, init) => {
      return new Promise<Response>((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const abortError = new Error("The operation was aborted.");
            (abortError as Error & { name: string }).name = "AbortError";
            reject(abortError);
          });
        }
      });
    });

    const promise = chat(sampleMessages);
    const timerPromise = vi.advanceTimersByTimeAsync(120_000);
    const [, chatResult] = await Promise.allSettled([timerPromise, promise]);

    expect(chatResult.status).toBe("rejected");
    if (chatResult.status === "rejected") {
      expect(chatResult.reason.message).toMatch(/timed out after 120s/);
    }
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("chatJSON parses JSON response and strips markdown fences", async () => {
    const { chatJSON } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '```json\n{"answer": 42}\n```',
            },
          },
        ],
      }),
    });

    const result = await chatJSON<{ answer: number }>(sampleMessages);
    expect(result).toEqual({ answer: 42 });
  });

  it("chatJSON passes json: true option to chat", async () => {
    const { chatJSON } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{"ok": true}' } }],
      }),
    });

    await chatJSON(sampleMessages);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("sends model from config-service in the request body", async () => {
    // Re-mock config-service for this test to return a different chat model.
    const cfgMod = await import("@/lib/config-service");
    vi.mocked(cfgMod.getChatModel).mockResolvedValueOnce("anthropic/claude-3.5-sonnet");
    const { chat } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    });
    await chat(sampleMessages);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("sends apiKey from config-service in Authorization header", async () => {
    const cfgMod = await import("@/lib/config-service");
    vi.mocked(cfgMod.getApiKey).mockResolvedValueOnce("sk-from-config-service");
    const { chat } = await import("@/lib/domain/llm/LLMClient");
    mockFetchSequence({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "ok" } }],
      }),
    });
    await chat(sampleMessages);
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    const headers = (init!.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-from-config-service");
  });
});

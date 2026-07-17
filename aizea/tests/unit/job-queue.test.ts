import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockAdd, mockGetState, mockFromId, mockClose } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockGetState: vi.fn(),
  mockFromId: vi.fn(),
  mockClose: vi.fn(),
}));

vi.mock("bullmq", () => {
  return {
    Queue: vi.fn(function () {
      return {
        add: mockAdd,
        close: mockClose,
      };
    }),
    Job: {
      fromId: mockFromId,
    },
  };
});

vi.mock("@/lib/config", () => ({
  config: {
    openrouter: { apiKey: "test-key", model: "test-model" },
    database: { url: "file:./test.db" },
    redis: { url: "redis://localhost:6379" },
    upload: { bodySizeLimit: 262144000 },
  },
}));

import { JobQueue } from "@/lib/infrastructure/queue/JobQueue";

describe("JobQueue", () => {
  let queue: JobQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    // skipProbe: true → preserves the previous test contract
    // (queue immediately available, no ioredis probe).
    queue = new JobQueue("redis://localhost:6379", { skipProbe: true });
  });

  afterEach(async () => {
    await queue.close();
  });

  describe("enqueue", () => {
    it("returns a jobId when adding a generate-outline job", async () => {
      mockAdd.mockResolvedValue({ id: "job-123" });

      const result = await queue.enqueue("generate-outline", {
        courseId: "course-1",
        selectedNodeIds: ["n-1", "n-2"],
      });

      expect(result).toEqual({ jobId: "job-123" });
      expect(mockAdd).toHaveBeenCalledWith("generate-outline", {
        courseId: "course-1",
        selectedNodeIds: ["n-1", "n-2"],
      });
    });

    it("returns a jobId when adding a generate-slide-content job", async () => {
      mockAdd.mockResolvedValue({ id: "job-456" });

      const result = await queue.enqueue("generate-slide-content", {
        slideId: "slide-1",
      });

      expect(result).toEqual({ jobId: "job-456" });
      expect(mockAdd).toHaveBeenCalledWith("generate-slide-content", {
        slideId: "slide-1",
      });
    });
  });

  describe("getStatus", () => {
    it("returns status and progress for an existing job", async () => {
      mockFromId.mockResolvedValue({
        getState: mockGetState.mockResolvedValue("completed"),
        progress: 100,
      });

      const result = await queue.getStatus("job-123");

      expect(result).toEqual({ status: "completed", progress: 100 });
      expect(mockFromId).toHaveBeenCalledWith(expect.anything(), "job-123");
    });

    it("returns progress 0 when job has no progress", async () => {
      mockFromId.mockResolvedValue({
        getState: mockGetState.mockResolvedValue("waiting"),
        progress: undefined,
      });

      const result = await queue.getStatus("job-789");

      expect(result).toEqual({ status: "waiting", progress: 0 });
    });

    it("throws when job is not found", async () => {
      mockFromId.mockResolvedValue(null);

      await expect(queue.getStatus("non-existent")).rejects.toThrow(
        "Trabajo no encontrado"
      );
    });
  });
});

describe("JobQueue — Redis probe", () => {
  // Re-mock bullmq to allow per-test control of the probe outcome.
  // These tests exercise the real constructor path (no skipProbe),
  // so they need ioredis to be mocked too.
  let pingMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    pingMock = vi.fn();
    vi.doMock("ioredis", () => {
      return {
        default: vi.fn(function () {
          const instance = {
            on: vi.fn(),
            ping: pingMock,
            disconnect: vi.fn(),
          };
          return instance;
        }),
      };
    });
    vi.doMock("bullmq", () => ({
      Queue: vi.fn(function () {
        return { add: vi.fn(), close: vi.fn() };
      }),
      Job: { fromId: vi.fn() },
    }));
    vi.doMock("@/lib/config", () => ({
      config: {
        openrouter: { apiKey: "test-key", model: "test-model" },
        database: { url: "file:./test.db" },
        redis: { url: "redis://localhost:6379" },
        upload: { bodySizeLimit: 262144000 },
      },
    }));
  });

  it("marks the queue available when the Redis probe succeeds", async () => {
    pingMock.mockResolvedValue("PONG");
    const mod = await import("@/lib/infrastructure/queue/JobQueue");
    const q = new mod.JobQueue("redis://localhost:6379", {
      probeTimeoutMs: 500,
    });
    const ok = await q.waitForProbe();
    expect(ok).toBe(true);
    expect(q.isAvailable()).toBe(true);
    await q.close();
  });

  it("marks the queue unavailable when the Redis probe fails", async () => {
    pingMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const mod = await import("@/lib/infrastructure/queue/JobQueue");
    const q = new mod.JobQueue("redis://localhost:6379", {
      probeTimeoutMs: 500,
    });
    const ok = await q.waitForProbe();
    expect(ok).toBe(false);
    expect(q.isAvailable()).toBe(false);
    await q.close();
  });

  it("marks the queue unavailable when the probe times out", async () => {
    // Never resolves → the timeout-driven settle flips the flag.
    pingMock.mockReturnValue(new Promise(() => {}));
    const mod = await import("@/lib/infrastructure/queue/JobQueue");
    const q = new mod.JobQueue("redis://localhost:6379", {
      probeTimeoutMs: 50,
    });
    const ok = await q.waitForProbe();
    expect(ok).toBe(false);
    expect(q.isAvailable()).toBe(false);
    await q.close();
  });

  it("returns a no-op jobId from enqueue when Redis is unavailable", async () => {
    pingMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const mod = await import("@/lib/infrastructure/queue/JobQueue");
    const q = new mod.JobQueue("redis://localhost:6379", {
      probeTimeoutMs: 200,
    });
    await q.waitForProbe();
    const result = await q.enqueue("extract-unit", {
      unitId: "u-1",
      materialId: "m-1",
    });
    expect(result).toEqual({ jobId: "local-noredis" });
    await q.close();
  });
});

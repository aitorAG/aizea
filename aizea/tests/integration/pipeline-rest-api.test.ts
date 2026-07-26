import { describe, it, expect, vi, beforeEach } from "vitest";

// Integration test for the Fase 3-D REST pipeline bridge. The routes delegate
// to the server actions, which route through the composition root. We mock the
// container so we can assert the HTTP status mapping and JSON shape without a
// real DB. `next/cache` is mocked because the action calls revalidatePath.

const { mockExists, mockFindByCourseId, mockEnqueue, mockPump, mockFindById, mockUpdate } =
  vi.hoisted(() => ({
    mockExists: vi.fn(),
    mockFindByCourseId: vi.fn(),
    mockEnqueue: vi.fn(),
    mockPump: vi.fn().mockResolvedValue(undefined),
    mockFindById: vi.fn(),
    mockUpdate: vi.fn(),
  }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/composition/container", () => ({
  container: {
    courses: { exists: mockExists },
    materials: { findByCourseId: mockFindByCourseId },
    jobQueue: { enqueue: mockEnqueue },
    pipelineWorker: { pump: mockPump, recover: vi.fn() },
    processCourse: { execute: vi.fn() },
    processingJobs: { findById: mockFindById, update: mockUpdate },
  },
}));

let startPost: typeof import("@/app/api/pipeline/start/route").POST;
let cancelPost: typeof import("@/app/api/pipeline/[jobId]/cancel/route").POST;

beforeEach(async () => {
  vi.clearAllMocks();
  mockPump.mockResolvedValue(undefined);
  startPost = (await import("@/app/api/pipeline/start/route")).POST;
  cancelPost = (await import("@/app/api/pipeline/[jobId]/cancel/route")).POST;
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/pipeline/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pipeline/start (Fase 3-D)", () => {
  it("enqueues and returns 200 with runId when materials exist", async () => {
    mockExists.mockResolvedValue(true);
    mockFindByCourseId.mockResolvedValue([{ id: "m-1", filename: "a.pdf" }]);
    mockEnqueue.mockResolvedValue({ runId: "run-123" });

    const res = await startPost(jsonRequest({ courseId: "c-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, empty: false, enqueued: true, runId: "run-123" });
    expect(mockEnqueue).toHaveBeenCalledWith({ courseId: "c-1" });
    expect(mockPump).toHaveBeenCalled();
  });

  it("returns 200 NO_MATERIALS (without enqueuing) when the course has none", async () => {
    mockExists.mockResolvedValue(true);
    mockFindByCourseId.mockResolvedValue([]);

    const res = await startPost(jsonRequest({ courseId: "c-empty" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, empty: true, reason: "NO_MATERIALS" });
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("returns 404 when the course does not exist", async () => {
    mockExists.mockResolvedValue(false);
    const res = await startPost(jsonRequest({ courseId: "ghost" }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns 400 when courseId is missing", async () => {
    const res = await startPost(jsonRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it("returns 400 on invalid JSON", async () => {
    const req = new Request("http://localhost/api/pipeline/start", {
      method: "POST",
      body: "not json{",
    });
    const res = await startPost(req);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/pipeline/[jobId]/cancel (Fase 3-D)", () => {
  it("cancels a running job and returns 200", async () => {
    mockFindById.mockResolvedValue({ id: "job-1", status: "running" });
    mockUpdate.mockResolvedValue({});
    const res = await cancelPost(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ jobId: "job-1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, jobId: "job-1", status: "cancelled" });
  });

  it("is idempotent: returns 200 with current status for a completed job", async () => {
    mockFindById.mockResolvedValue({ id: "job-done", status: "completed" });
    const res = await cancelPost(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ jobId: "job-done" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the job does not exist", async () => {
    mockFindById.mockResolvedValue(null);
    const res = await cancelPost(new Request("http://localhost/x", { method: "POST" }), {
      params: Promise.resolve({ jobId: "ghost" }),
    });
    expect(res.status).toBe(404);
  });
});

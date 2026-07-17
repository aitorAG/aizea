import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockProcessingJobFindUnique,
} = vi.hoisted(() => ({
  mockProcessingJobFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    processingJob: {
      findUnique: mockProcessingJobFindUnique,
    },
  },
}));

import { GET } from "@/app/api/pipeline/[jobId]/status/route";
import { NextRequest } from "next/server";

const baseUrl = "http://localhost:3000";

describe("GET /api/pipeline/[jobId]/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with the job status when the job exists", async () => {
    mockProcessingJobFindUnique.mockResolvedValue({
      id: "job-123",
      type: "extraction",
      status: "running",
      progress: 50,
      total: 100,
      currentStep: "Unit 5/10",
      error: null,
      courseId: "c-1",
      materialId: "m-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const req = new NextRequest(`${baseUrl}/api/pipeline/job-123/status`);
    const res = await GET(req, { params: Promise.resolve({ jobId: "job-123" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe("job-123");
    expect(json.status).toBe("running");
    expect(json.progress).toBe(50);
    expect(json.total).toBe(100);
    expect(json.phase).toBe("extraction");
  });

  it("returns the correct fields: id, phase, status, progress, total, currentStep, error", async () => {
    mockProcessingJobFindUnique.mockResolvedValue({
      id: "job-abc",
      type: "integration",
      status: "completed",
      progress: 100,
      total: 100,
      currentStep: "Done",
      error: null,
      courseId: "c-1",
      materialId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const req = new NextRequest(`${baseUrl}/api/pipeline/job-abc/status`);
    const res = await GET(req, { params: Promise.resolve({ jobId: "job-abc" }) });
    const json = await res.json();
    expect(json).toMatchObject({
      id: "job-abc",
      phase: "integration",
      status: "completed",
      progress: 100,
      total: 100,
      currentStep: "Done",
    });
  });

  it("returns 404 when the job does not exist", async () => {
    mockProcessingJobFindUnique.mockResolvedValue(null);
    const req = new NextRequest(`${baseUrl}/api/pipeline/non-existent/status`);
    const res = await GET(req, { params: Promise.resolve({ jobId: "non-existent" }) });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });

  it("includes error message in the response when the job has failed", async () => {
    mockProcessingJobFindUnique.mockResolvedValue({
      id: "job-fail",
      type: "extraction",
      status: "failed",
      progress: 30,
      total: 100,
      currentStep: null,
      error: "OpenRouter 503",
      courseId: "c-1",
      materialId: "m-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const req = new NextRequest(`${baseUrl}/api/pipeline/job-fail/status`);
    const res = await GET(req, { params: Promise.resolve({ jobId: "job-fail" }) });
    const json = await res.json();
    expect(json.status).toBe("failed");
    expect(json.error).toBe("OpenRouter 503");
  });

  it("includes courseId and materialId in the response", async () => {
    mockProcessingJobFindUnique.mockResolvedValue({
      id: "job-1",
      type: "tree-building",
      status: "running",
      progress: 10,
      total: 100,
      currentStep: "Building tree",
      error: null,
      courseId: "course-42",
      materialId: "mat-99",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const req = new NextRequest(`${baseUrl}/api/pipeline/job-1/status`);
    const res = await GET(req, { params: Promise.resolve({ jobId: "job-1" }) });
    const json = await res.json();
    expect(json.courseId).toBe("course-42");
    expect(json.materialId).toBe("mat-99");
  });

  it("returns 500 when the database throws", async () => {
    mockProcessingJobFindUnique.mockRejectedValue(new Error("DB down"));
    const req = new NextRequest(`${baseUrl}/api/pipeline/job-x/status`);
    const res = await GET(req, { params: Promise.resolve({ jobId: "job-x" }) });
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBeTruthy();
  });
});

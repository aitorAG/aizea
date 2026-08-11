import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { migrationSqlFiles } from "../helpers/migrate-test-db";

const TEST_DB = join(process.cwd(), "prisma", "test-actions-pipeline.db");
const TEST_DB_URL = `file:${TEST_DB}`;

for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
}
process.env.DATABASE_URL = TEST_DB_URL;

const testDb = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
// Apply ALL migrations in order (picks up new columns automatically).
for (const migrationPath of migrationSqlFiles()) {
  const sql = readFileSync(migrationPath, "utf-8");
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await testDb.$executeRawUnsafe(stmt);
  }
}

vi.mock("@/lib/db", () => ({ db: testDb }));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const { mockProcessCourse, mockPump } = vi.hoisted(() => ({
  mockProcessCourse: vi.fn(),
  mockPump: vi.fn().mockResolvedValue(undefined),
}));

// 1.3 + 2.2: pipeline actions route through the composition root. We back the
// container mock with the REAL Prisma repos (queries identical to prod, on the
// mocked testDb). Fase 2.2: `startPipelineAction` now ENQUEUES a run and fires
// the worker's pump instead of running the pipeline inline, so the mock must
// expose `materials` (NO_MATERIALS guard), a real `jobQueue` (PrismaJobQueue,
// so enqueue persists a pipeline-run row we can assert on) and a spy
// `pipelineWorker.pump`.
vi.mock("@/lib/composition/container", async () => {
  const { PrismaProcessingJobRepository } = await import(
    "@/lib/infrastructure/persistence/prisma-processing-job.repository"
  );
  const { PrismaCourseRepository } = await import(
    "@/lib/infrastructure/persistence/prisma-course.repository"
  );
  const { PrismaMaterialRepository } = await import(
    "@/lib/infrastructure/persistence/prisma-material.repository"
  );
  const { PrismaJobQueue } = await import(
    "@/lib/infrastructure/queue/prisma-job-queue"
  );
  return {
    container: {
      processCourse: { execute: mockProcessCourse },
      processingJobs: new PrismaProcessingJobRepository(),
      courses: new PrismaCourseRepository(),
      materials: new PrismaMaterialRepository(),
      jobQueue: new PrismaJobQueue(),
      pipelineWorker: { pump: mockPump, recover: vi.fn().mockResolvedValue(0) },
    },
  };
});

let startPipelineAction: typeof import("@/lib/actions/pipeline").startPipelineAction;
let getJobStatusAction: typeof import("@/lib/actions/pipeline").getJobStatusAction;
let listActiveJobsAction: typeof import("@/lib/actions/pipeline").listActiveJobsAction;
let cancelPipelineAction: typeof import("@/lib/actions/pipeline").cancelPipelineAction;

beforeAll(async () => {
  const mod = await import("@/lib/actions/pipeline");
  startPipelineAction = mod.startPipelineAction;
  getJobStatusAction = mod.getJobStatusAction;
  listActiveJobsAction = mod.listActiveJobsAction;
  cancelPipelineAction = mod.cancelPipelineAction;
});

afterAll(async () => {
  await testDb.$disconnect();
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
  }
});

beforeEach(async () => {
  vi.clearAllMocks();
  // Wipe the relevant tables between tests
  await testDb.processingJob.deleteMany({});
  await testDb.course.deleteMany({});
  mockProcessCourse.mockResolvedValue({
    ok: true,
    empty: false,
    result: {
      segmentationJobId: "seg-1",
      extractionJobId: "ext-1",
      integrationJobId: "int-1",
      treeBuildingJobId: "tree-1",
      empty: false,
      message: null,
    },
  });
});

describe("startPipelineAction (Fase 2.2 — enqueue contract)", () => {
  // Helper: create a course WITH a material so the NO_MATERIALS guard passes
  // and the action reaches the enqueue path.
  async function courseWithMaterial(name: string) {
    const course = await testDb.course.create({ data: { name } });
    await testDb.material.create({
      data: {
        id: `m-${course.id}`,
        courseId: course.id,
        filename: "doc.pdf",
        content: "some text",
        pageCount: 1,
      },
    });
    return course;
  }

  it("rejects when the course does not exist", async () => {
    const result = await startPipelineAction("non-existent-course");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/curso/i);
    }
  });

  it("returns NO_MATERIALS (synchronously, without enqueuing) when the course has no materials", async () => {
    const course = await testDb.course.create({ data: { name: "Empty" } });
    const result = await startPipelineAction(course.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.empty).toBe(true);
      if (result.empty) {
        expect(result.reason).toBe("NO_MATERIALS");
        expect(result.message).toMatch(/sube un pdf/i);
      }
    }
    // No run was enqueued and the worker was NOT kicked.
    expect(mockPump).not.toHaveBeenCalled();
    const runs = await testDb.processingJob.findMany({
      where: { type: "pipeline-run" },
    });
    expect(runs).toHaveLength(0);
  });

  it("enqueues a pipeline-run and fires the worker when materials exist", async () => {
    const course = await courseWithMaterial("Test");
    const result = await startPipelineAction(course.id);
    expect(result.ok).toBe(true);
    if (result.ok && !result.empty) {
      expect(result.enqueued).toBe(true);
      expect(result.runId).toMatch(/^run-/);
    }
    // The run row was persisted as pending/running for the worker to claim.
    const runs = await testDb.processingJob.findMany({
      where: { type: "pipeline-run", courseId: course.id },
    });
    expect(runs).toHaveLength(1);
    // The worker's pump was kicked (fire-and-forget).
    expect(mockPump).toHaveBeenCalled();
    // The pipeline is NOT run inline anymore.
    expect(mockProcessCourse).not.toHaveBeenCalled();
  });

  it("returns ok:false when enqueue throws", async () => {
    const course = await courseWithMaterial("Boom");
    // Force the queue create to fail by dropping the course row's FK target
    // is overkill; instead spy through the real queue by making create throw.
    const spy = vi
      .spyOn(testDb.processingJob, "create")
      .mockRejectedValueOnce(new Error("db down"));
    const result = await startPipelineAction(course.id);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/db down/i);
    }
    spy.mockRestore();
  });
});

describe("getJobStatusAction", () => {
  it("returns the job status with phase, progress, total", async () => {
    const job = await testDb.processingJob.create({
      data: {
        id: "job-1",
        type: "extraction",
        status: "running",
        progress: 50,
        total: 100,
        currentStep: "Unit 5/10",
      },
    });
    const result = await getJobStatusAction(job.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.id).toBe("job-1");
      expect(result.job.phase).toBe("extraction");
      expect(result.job.status).toBe("running");
      expect(result.job.progress).toBe(50);
      expect(result.job.total).toBe(100);
      expect(result.job.currentStep).toBe("Unit 5/10");
    }
  });

  it("returns ok: false when the job does not exist", async () => {
    const result = await getJobStatusAction("non-existent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no encontr/i);
    }
  });

  it("includes the error message for failed jobs", async () => {
    const job = await testDb.processingJob.create({
      data: {
        id: "job-fail",
        type: "tree-building",
        status: "failed",
        progress: 0,
        total: 100,
        error: "OpenRouter 503",
      },
    });
    const result = await getJobStatusAction(job.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.job.status).toBe("failed");
      expect(result.job.error).toBe("OpenRouter 503");
    }
  });
});

describe("listActiveJobsAction", () => {
  it("returns an empty list when no jobs are active", async () => {
    const result = await listActiveJobsAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobs).toEqual([]);
    }
  });

  it("returns pending and running jobs plus RECENT completed/failed jobs (old ones excluded)", async () => {
    const now = new Date();
    // 1 minute ago — well outside the 30s recent window. Anything
    // older than 30s in a terminal state is considered historical
    // and must NOT appear (v1.5 #2.3).
    const longAgo = new Date(Date.now() - 60 * 1000);
    await testDb.processingJob.create({
      data: { id: "j-pending", type: "segmentation", status: "pending" },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-running",
        type: "extraction",
        status: "running",
        progress: 25,
        currentStep: "Unit 2/10",
        courseId: "c-1",
      },
    });
    // Recent completed / failed (within the 30s window) — included.
    await testDb.processingJob.create({
      data: {
        id: "j-done",
        type: "tree-building",
        status: "completed",
        progress: 100,
        updatedAt: now,
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-failed",
        type: "extraction",
        status: "failed",
        error: "Boom",
        updatedAt: now,
      },
    });
    // Old completed / failed (outside the 30s window) — excluded.
    await testDb.processingJob.create({
      data: {
        id: "j-old-done",
        type: "tree-building",
        status: "completed",
        progress: 100,
        updatedAt: longAgo,
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-old-failed",
        type: "extraction",
        status: "failed",
        error: "Long ago",
        updatedAt: longAgo,
      },
    });

    const result = await listActiveJobsAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.jobs.map((j) => j.jobId);
      expect(ids).toContain("j-pending");
      expect(ids).toContain("j-running");
      expect(ids).toContain("j-done");
      expect(ids).toContain("j-failed");
      expect(ids).not.toContain("j-old-done");
      expect(ids).not.toContain("j-old-failed");
    }
  });

  it("EXCLUDES terminal jobs older than 30 seconds (v1.5 #2.3 regression)", async () => {
    // 31s old — just past the cutoff. Must NOT appear.
    const justOverCutoff = new Date(Date.now() - 31 * 1000);
    // 5 minutes old — also outside. Must NOT appear.
    const wayOld = new Date(Date.now() - 5 * 60 * 1000);
    await testDb.processingJob.create({
      data: {
        id: "j-just-over",
        type: "tree-building",
        status: "completed",
        updatedAt: justOverCutoff,
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-way-old",
        type: "tree-building",
        status: "completed",
        updatedAt: wayOld,
      },
    });
    // A running job from yesterday is still in-flight and must appear.
    await testDb.processingJob.create({
      data: {
        id: "j-still-running",
        type: "extraction",
        status: "running",
        progress: 10,
        updatedAt: wayOld,
      },
    });

    const result = await listActiveJobsAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.jobs.map((j) => j.jobId);
      expect(ids).not.toContain("j-just-over");
      expect(ids).not.toContain("j-way-old");
      expect(ids).toContain("j-still-running");
    }
  });

  it("INCLUDES terminal jobs within the 30-second window so the banner survives a reload", async () => {
    // 5s old — well within the 30s window. Must appear.
    const veryRecent = new Date(Date.now() - 5 * 1000);
    await testDb.processingJob.create({
      data: {
        id: "j-very-recent-done",
        type: "tree-building",
        status: "completed",
        updatedAt: veryRecent,
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-very-recent-failed",
        type: "extraction",
        status: "failed",
        updatedAt: veryRecent,
      },
    });

    const result = await listActiveJobsAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.jobs.map((j) => j.jobId);
      expect(ids).toContain("j-very-recent-done");
      expect(ids).toContain("j-very-recent-failed");
    }
  });

  it("filters by courseId when provided (only jobs for the current course are returned)", async () => {
    // Same status, different courses.
    await testDb.processingJob.create({
      data: {
        id: "j-mine",
        type: "extraction",
        status: "running",
        courseId: "course-current",
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-other",
        type: "extraction",
        status: "running",
        courseId: "course-other",
      },
    });

    const result = await listActiveJobsAction({ courseId: "course-current" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.jobs.map((j) => j.jobId);
      expect(ids).toContain("j-mine");
      expect(ids).not.toContain("j-other");
      // Every returned job belongs to the requested course.
      for (const j of result.jobs) {
        expect(j.courseId).toBe("course-current");
      }
    }
  });

  it("returns jobs for every course when courseId is omitted", async () => {
    await testDb.processingJob.create({
      data: {
        id: "j-mine",
        type: "extraction",
        status: "running",
        courseId: "course-current",
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-other",
        type: "extraction",
        status: "running",
        courseId: "course-other",
      },
    });

    const result = await listActiveJobsAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.jobs.map((j) => j.jobId);
      expect(ids).toContain("j-mine");
      expect(ids).toContain("j-other");
    }
  });

  it("orders results by updatedAt DESC (newest first)", async () => {
    const oldest = new Date(Date.now() - 5_000);
    const middle = new Date(Date.now() - 3_000);
    const newest = new Date(Date.now() - 1_000);
    // Created in arbitrary order to prove the order comes from the
    // server, not from the create() sequence.
    await testDb.processingJob.create({
      data: {
        id: "j-newest",
        type: "extraction",
        status: "running",
        updatedAt: newest,
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-oldest",
        type: "extraction",
        status: "running",
        updatedAt: oldest,
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-middle",
        type: "extraction",
        status: "running",
        updatedAt: middle,
      },
    });

    const result = await listActiveJobsAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.jobs.map((j) => j.jobId);
      expect(ids).toEqual(["j-newest", "j-middle", "j-oldest"]);
    }
  });

  it("maps the DB row to the ActiveJob shape the client store expects", async () => {
    await testDb.processingJob.create({
      data: {
        id: "j-shape",
        type: "segmentation",
        status: "running",
        progress: 50,
        currentStep: "Procesando",
        courseId: "c-42",
      },
    });
    const result = await listActiveJobsAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const job = result.jobs.find((j) => j.jobId === "j-shape");
      expect(job).toBeDefined();
      expect(job?.phase).toBe("segmentation");
      expect(job?.status).toBe("running");
      expect(job?.progress).toBe(50);
      expect(job?.currentStep).toBe("Procesando");
      expect(job?.courseId).toBe("c-42");
      expect(typeof job?.startedAt).toBe("number");
      expect(typeof job?.updatedAt).toBe("number");
    }
  });

  it("returns ok:false when the database throws", async () => {
    const original = testDb.processingJob.findMany;
    testDb.processingJob.findMany = vi
      .fn()
      .mockRejectedValueOnce(new Error("DB down")) as typeof original;
    try {
      const result = await listActiveJobsAction();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toMatch(/db down/i);
      }
    } finally {
      testDb.processingJob.findMany = original;
    }
  });

  it("includes recently-cancelled jobs (within the 30s window) so the banner survives a reload", async () => {
    const now = new Date();
    // 1 minute ago — outside the 30s window. Must NOT appear (v1.5 #2.3).
    const longAgo = new Date(Date.now() - 60 * 1000);
    await testDb.processingJob.create({
      data: {
        id: "j-recent-cancel",
        type: "extraction",
        status: "cancelled",
        updatedAt: now,
      },
    });
    await testDb.processingJob.create({
      data: {
        id: "j-old-cancel",
        type: "extraction",
        status: "cancelled",
        updatedAt: longAgo,
      },
    });

    const result = await listActiveJobsAction();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.jobs.map((j) => j.jobId);
      expect(ids).toContain("j-recent-cancel");
      expect(ids).not.toContain("j-old-cancel");
    }
  });
});

describe("cancelPipelineAction", () => {
  it("rejects when the job does not exist", async () => {
    const result = await cancelPipelineAction("non-existent");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no encontr/i);
    }
  });

  it("marks a running job as cancelled in the DB", async () => {
    await testDb.processingJob.create({
      data: {
        id: "j-cancel-running",
        type: "extraction",
        status: "running",
        progress: 42,
        currentStep: "Unit 5/10",
      },
    });

    const result = await cancelPipelineAction("j-cancel-running");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobId).toBe("j-cancel-running");
      expect(result.status).toBe("cancelled");
    }

    // Verify the row was actually updated in the DB.
    const row = await testDb.processingJob.findUnique({
      where: { id: "j-cancel-running" },
    });
    expect(row?.status).toBe("cancelled");
    expect(row?.error).toMatch(/cancelado/i);
  });

  it("is idempotent on an already-cancelled job", async () => {
    await testDb.processingJob.create({
      data: {
        id: "j-cancel-twice",
        type: "extraction",
        status: "cancelled",
      },
    });
    const first = await cancelPipelineAction("j-cancel-twice");
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.status).toBe("cancelled");
    const second = await cancelPipelineAction("j-cancel-twice");
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.status).toBe("cancelled");
  });

  it("does not flip a completed job to cancelled", async () => {
    await testDb.processingJob.create({
      data: {
        id: "j-cancel-completed",
        type: "extraction",
        status: "completed",
        progress: 100,
      },
    });
    const result = await cancelPipelineAction("j-cancel-completed");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("completed");
    const row = await testDb.processingJob.findUnique({
      where: { id: "j-cancel-completed" },
    });
    expect(row?.status).toBe("completed");
  });

  it("does not flip a failed job to cancelled", async () => {
    await testDb.processingJob.create({
      data: {
        id: "j-cancel-failed",
        type: "extraction",
        status: "failed",
        error: "Boom",
      },
    });
    const result = await cancelPipelineAction("j-cancel-failed");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.status).toBe("failed");
    const row = await testDb.processingJob.findUnique({
      where: { id: "j-cancel-failed" },
    });
    expect(row?.status).toBe("failed");
    expect(row?.error).toBe("Boom");
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// Integration test for the pipeline queue + worker (Fase 2.1/2.2/2.3).
// This IS the phase gate: a long pipeline runs WITHOUT blocking the enqueue,
// is cancelable, and is resumable. Uses the REAL PrismaJobQueue + PipelineWorker
// on a temp SQLite DB (migration replay). `runCourse` is a controllable stub so
// we can simulate a slow / cancelling / crashing pipeline without the LLM.

const TEST_DB = join(process.cwd(), "prisma", "test-pipeline-queue.db");
const TEST_DB_URL = `file:${TEST_DB}`;
const MIGRATION_SQL = join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260711161501_add_pipeline_tables",
  "migration.sql"
);

let testDb: PrismaClient;

beforeAll(async () => {
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
  }
  process.env.DATABASE_URL = TEST_DB_URL;
  testDb = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  const sql = readFileSync(MIGRATION_SQL, "utf-8");
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await testDb.$executeRawUnsafe(stmt);
  }
});

afterAll(async () => {
  if (testDb) await testDb.$disconnect();
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
  }
});

beforeEach(async () => {
  await testDb.processingJob.deleteMany({});
});

import { PrismaJobQueue } from "@/lib/infrastructure/queue/prisma-job-queue";
import { PipelineWorker } from "@/lib/infrastructure/queue/pipeline-worker";
import { PipelineCancelledError } from "@/lib/infrastructure/pipeline/pipeline.service";

function makeQueue() {
  return new PrismaJobQueue(testDb);
}

describe("Pipeline queue + worker integration (Fase 2 GATE)", () => {
  it("enqueue does NOT block on a slow pipeline (returns before runCourse resolves)", async () => {
    const queue = makeQueue();
    let runResolved = false;
    let releaseRun: () => void = () => {};
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    const worker = new PipelineWorker({
      queue,
      runCourse: async () => {
        await runGate; // block until we release it
        runResolved = true;
      },
    });

    // Enqueue + kick the worker fire-and-forget (mirrors startPipelineAction).
    const run = await queue.enqueue({ courseId: "c-slow" });
    void worker.pump();

    // The enqueue + fire returned even though runCourse is still blocked.
    expect(runResolved).toBe(false);
    const midRun = await queue.findRun(run.runId);
    expect(midRun?.status === "pending" || midRun?.status === "running").toBe(true);

    // Release the slow pipeline and let the worker finish.
    releaseRun();
    await worker.pump(); // await the drain to completion

    expect(runResolved).toBe(true);
    expect((await queue.findRun(run.runId))?.status).toBe("completed");
  });

  it("drains multiple enqueued runs to completion", async () => {
    const queue = makeQueue();
    const processed: string[] = [];
    const worker = new PipelineWorker({
      queue,
      runCourse: async (courseId) => {
        processed.push(courseId);
      },
    });

    await queue.enqueue({ courseId: "c-1" });
    await queue.enqueue({ courseId: "c-2" });
    await worker.pump();

    expect(processed.sort()).toEqual(["c-1", "c-2"]);
    const runs = await testDb.processingJob.findMany({
      where: { type: "pipeline-run" },
    });
    expect(runs.every((r) => r.status === "completed")).toBe(true);
  });

  it("is cancelable: a PipelineCancelledError marks the run cancelled, not failed", async () => {
    const queue = makeQueue();
    const worker = new PipelineWorker({
      queue,
      runCourse: async () => {
        // Simulate the cooperative-cancel path bubbling out of the pipeline.
        throw new PipelineCancelledError("phase-extraction-1");
      },
    });

    const run = await queue.enqueue({ courseId: "c-cancel" });
    await worker.pump();

    expect((await queue.findRun(run.runId))?.status).toBe("cancelled");
  });

  it("records a failed run and continues (a crashing pipeline does not wedge the queue)", async () => {
    const queue = makeQueue();
    const worker = new PipelineWorker({
      queue,
      runCourse: async (courseId) => {
        if (courseId === "c-bad") throw new Error("docling down");
      },
    });

    const bad = await queue.enqueue({ courseId: "c-bad" });
    const good = await queue.enqueue({ courseId: "c-good" });
    await worker.pump();

    const badRun = await queue.findRun(bad.runId);
    expect(badRun?.status).toBe("failed");
    const badRow = await testDb.processingJob.findUnique({ where: { id: bad.runId } });
    expect(badRow?.error).toMatch(/docling down/);
    expect((await queue.findRun(good.runId))?.status).toBe("completed");
  });

  it("is resumable: a run left 'running' by a crash is recovered and reprocessed", async () => {
    const queue = makeQueue();
    const processed: string[] = [];
    const worker = new PipelineWorker({
      queue,
      runCourse: async (courseId) => {
        processed.push(courseId);
      },
      staleAfterMs: 5 * 60 * 1000,
    });

    // Simulate a crash: a run stuck in "running" with an old updatedAt.
    const stale = await queue.enqueue({ courseId: "c-resume" });
    await queue.claimNext(); // → running
    await testDb.processingJob.update({
      where: { id: stale.runId },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });

    // Recovery returns it to pending; the next pump reprocesses it.
    const recovered = await worker.recover();
    expect(recovered).toBe(1);
    await worker.pump();

    expect(processed).toContain("c-resume");
    expect((await queue.findRun(stale.runId))?.status).toBe("completed");
  });
});

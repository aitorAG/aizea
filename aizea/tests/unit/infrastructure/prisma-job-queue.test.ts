import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// Unit test for PrismaJobQueue (Fase 2.1). Uses a temp SQLite DB built by
// replaying the pipeline-tables migration SQL — same pattern as the other
// pipeline tests. The queue is backed by the existing ProcessingJob table
// (type="pipeline-run"), so no new migration is needed.

const TEST_DB = join(process.cwd(), "prisma", "test-prisma-job-queue.db");
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

// Import AFTER the mock-free setup; the queue takes the client as a ctor arg.
import { PrismaJobQueue } from "@/lib/infrastructure/queue/prisma-job-queue";
import { PIPELINE_RUN_TYPE } from "@/lib/application/ports/job-queue.port";

function makeQueue() {
  return new PrismaJobQueue(testDb);
}

describe("PrismaJobQueue (Fase 2.1)", () => {
  it("enqueue creates a pending pipeline-run row", async () => {
    const queue = makeQueue();
    const run = await queue.enqueue({ courseId: "c-1" });
    expect(run.status).toBe("pending");
    expect(run.courseId).toBe("c-1");

    const row = await testDb.processingJob.findUnique({ where: { id: run.runId } });
    expect(row?.type).toBe(PIPELINE_RUN_TYPE);
    expect(row?.status).toBe("pending");
  });

  it("claimNext returns the oldest pending run and marks it running", async () => {
    const queue = makeQueue();
    const first = await queue.enqueue({ courseId: "c-first" });
    // Ensure a distinct createdAt ordering.
    await new Promise((r) => setTimeout(r, 5));
    await queue.enqueue({ courseId: "c-second" });

    const claimed = await queue.claimNext();
    expect(claimed?.runId).toBe(first.runId);
    expect(claimed?.status).toBe("running");

    const row = await testDb.processingJob.findUnique({ where: { id: first.runId } });
    expect(row?.status).toBe("running");
  });

  it("claimNext returns null when there are no pending runs", async () => {
    const queue = makeQueue();
    expect(await queue.claimNext()).toBeNull();
  });

  it("claimNext does not re-claim an already-running run", async () => {
    const queue = makeQueue();
    await queue.enqueue({ courseId: "c-1" });
    const first = await queue.claimNext();
    expect(first).not.toBeNull();
    // Second claim: nothing left pending.
    expect(await queue.claimNext()).toBeNull();
  });

  it("markCompleted / markFailed set terminal state", async () => {
    const queue = makeQueue();
    const a = await queue.enqueue({ courseId: "c-a" });
    const b = await queue.enqueue({ courseId: "c-b" });

    await queue.markCompleted(a.runId);
    await queue.markFailed(b.runId, "boom");

    expect((await queue.findRun(a.runId))?.status).toBe("completed");
    const bRun = await queue.findRun(b.runId);
    expect(bRun?.status).toBe("failed");
    const bRow = await testDb.processingJob.findUnique({ where: { id: b.runId } });
    expect(bRow?.error).toBe("boom");
  });

  it("markCancelled is idempotent on terminal runs", async () => {
    const queue = makeQueue();
    const done = await queue.enqueue({ courseId: "c-done" });
    await queue.markCompleted(done.runId);
    // Cancelling a completed run must NOT flip it to cancelled.
    await queue.markCancelled(done.runId);
    expect((await queue.findRun(done.runId))?.status).toBe("completed");

    const live = await queue.enqueue({ courseId: "c-live" });
    await queue.markCancelled(live.runId);
    expect((await queue.findRun(live.runId))?.status).toBe("cancelled");
  });

  it("findRun ignores non-run rows (phase jobs)", async () => {
    const queue = makeQueue();
    // A phase job (different type) must not be returned as a run.
    await testDb.processingJob.create({
      data: { id: "phase-1", type: "extraction", status: "running", courseId: "c-1" },
    });
    expect(await queue.findRun("phase-1")).toBeNull();
  });

  it("recoverStale re-queues running runs older than the window", async () => {
    const queue = makeQueue();
    const stale = await queue.enqueue({ courseId: "c-stale" });
    await queue.claimNext(); // → running
    // Force updatedAt into the past.
    await testDb.processingJob.update({
      where: { id: stale.runId },
      data: { updatedAt: new Date(Date.now() - 10 * 60 * 1000) },
    });
    // A fresh running run must NOT be recovered.
    const fresh = await queue.enqueue({ courseId: "c-fresh" });
    await testDb.processingJob.update({
      where: { id: fresh.runId },
      data: { status: "running" },
    });

    const recovered = await queue.recoverStale(5 * 60 * 1000);
    expect(recovered).toBe(1);
    expect((await queue.findRun(stale.runId))?.status).toBe("pending");
    expect((await queue.findRun(fresh.runId))?.status).toBe("running");
  });
});

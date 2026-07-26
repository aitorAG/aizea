import { describe, it, expect, vi } from "vitest";
import { PipelineWorker } from "@/lib/infrastructure/queue/pipeline-worker";
import { PipelineCancelledError } from "@/lib/infrastructure/pipeline/pipeline.service";
import type {
  IJobQueue,
  PipelineRun,
  EnqueueRunInput,
} from "@/lib/application/ports/job-queue.port";

// In-memory fake queue for worker unit tests. FIFO by insertion order.
class FakeJobQueue implements IJobQueue {
  runs: PipelineRun[] = [];
  private seq = 0;

  async enqueue(input: EnqueueRunInput): Promise<PipelineRun> {
    const run: PipelineRun = {
      runId: `run-${++this.seq}`,
      courseId: input.courseId,
      materialId: input.materialId ?? null,
      status: "pending",
      createdAt: new Date(Date.now() + this.seq),
      updatedAt: new Date(),
    };
    this.runs.push(run);
    return run;
  }

  async claimNext(): Promise<PipelineRun | null> {
    const next = this.runs
      .filter((r) => r.status === "pending")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!next) return null;
    next.status = "running";
    return next;
  }

  async findRun(runId: string): Promise<PipelineRun | null> {
    return this.runs.find((r) => r.runId === runId) ?? null;
  }

  async markCompleted(runId: string): Promise<void> {
    const r = this.runs.find((x) => x.runId === runId);
    if (r) r.status = "completed";
  }

  async markFailed(runId: string): Promise<void> {
    const r = this.runs.find((x) => x.runId === runId);
    if (r) r.status = "failed";
  }

  async markCancelled(runId: string): Promise<void> {
    const r = this.runs.find((x) => x.runId === runId);
    if (r) r.status = "cancelled";
  }

  async recoverStale(): Promise<number> {
    let n = 0;
    for (const r of this.runs) {
      if (r.status === "running") {
        r.status = "pending";
        n++;
      }
    }
    return n;
  }
}

describe("PipelineWorker (Fase 2.2)", () => {
  it("drains the queue in FIFO order and marks each run completed", async () => {
    const queue = new FakeJobQueue();
    const processed: string[] = [];
    const worker = new PipelineWorker({
      queue,
      runCourse: async (courseId) => {
        processed.push(courseId);
      },
    });

    await queue.enqueue({ courseId: "c-1" });
    await queue.enqueue({ courseId: "c-2" });
    await queue.enqueue({ courseId: "c-3" });

    await worker.pump();

    expect(processed).toEqual(["c-1", "c-2", "c-3"]);
    expect(queue.runs.every((r) => r.status === "completed")).toBe(true);
  });

  it("marks a run failed and CONTINUES with the next when runCourse throws", async () => {
    const queue = new FakeJobQueue();
    const worker = new PipelineWorker({
      queue,
      runCourse: async (courseId) => {
        if (courseId === "c-bad") throw new Error("boom");
      },
    });

    const bad = await queue.enqueue({ courseId: "c-bad" });
    const good = await queue.enqueue({ courseId: "c-good" });

    await worker.pump();

    expect((await queue.findRun(bad.runId))?.status).toBe("failed");
    expect((await queue.findRun(good.runId))?.status).toBe("completed");
  });

  it("marks a run cancelled (not failed) on PipelineCancelledError", async () => {
    const queue = new FakeJobQueue();
    const worker = new PipelineWorker({
      queue,
      runCourse: async () => {
        throw new PipelineCancelledError("phase-job-1");
      },
    });

    const run = await queue.enqueue({ courseId: "c-cancel" });
    await worker.pump();

    expect((await queue.findRun(run.runId))?.status).toBe("cancelled");
  });

  it("pump is reentrant: concurrent calls share one drain (no double-processing)", async () => {
    const queue = new FakeJobQueue();
    const claimSpy = vi.spyOn(queue, "claimNext");
    const worker = new PipelineWorker({
      queue,
      runCourse: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
    });

    await queue.enqueue({ courseId: "c-1" });
    // Fire two pumps concurrently; they must resolve to the same drain.
    await Promise.all([worker.pump(), worker.pump()]);

    expect(queue.runs.every((r) => r.status === "completed")).toBe(true);
    // No run was claimed twice: exactly 2 claims (1 real + 1 empty terminator).
    expect(claimSpy.mock.calls.length).toBe(2);
  });

  it("recover delegates to recoverStale and returns the count", async () => {
    const queue = new FakeJobQueue();
    const worker = new PipelineWorker({ queue, runCourse: async () => {} });
    const r = await queue.enqueue({ courseId: "c-1" });
    await queue.claimNext(); // → running
    const count = await worker.recover();
    expect(count).toBe(1);
    expect((await queue.findRun(r.runId))?.status).toBe("pending");
  });
});

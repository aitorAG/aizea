import { describe, it, expect, beforeEach } from "vitest";
import { usePipelineStore, getActiveJobs, STUCK_THRESHOLD_MS, MAX_JOBS } from "@/lib/stores/usePipelineStore";

describe("usePipelineStore — initial state", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });

  it("starts with an empty jobs map", () => {
    expect(usePipelineStore.getState().jobs.size).toBe(0);
  });
});

describe("usePipelineStore — addJob", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });

  it("adds a job with the provided fields", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    const job = usePipelineStore.getState().jobs.get("j-1");
    expect(job).toBeDefined();
    expect(job?.jobId).toBe("j-1");
    expect(job?.courseId).toBe("c-1");
    expect(job?.phase).toBe("segmentation");
    expect(job?.status).toBe("running");
    expect(job?.progress).toBe(0);
  });

  it("sets isComplete when status is 'completed'", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "tree-building",
      status: "completed",
      progress: 100,
    });
    expect(usePipelineStore.getState().jobs.get("j-1")?.isComplete).toBe(true);
  });

  it("sets hasFailed when status is 'failed'", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "extraction",
      status: "failed",
      error: "Boom",
    });
    expect(usePipelineStore.getState().jobs.get("j-1")?.hasFailed).toBe(true);
  });

  it("stores a startedAt timestamp close to now", () => {
    const before = Date.now();
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    const after = Date.now();
    const job = usePipelineStore.getState().jobs.get("j-1");
    expect(job?.startedAt).toBeGreaterThanOrEqual(before);
    expect(job?.startedAt).toBeLessThanOrEqual(after);
  });

  it("merges into an existing job (re-adding)", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    const originalStartedAt = usePipelineStore.getState().jobs.get("j-1")?.startedAt;
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
      progress: 25,
      currentStep: "Step 1",
    });
    const job = usePipelineStore.getState().jobs.get("j-1");
    expect(job?.progress).toBe(25);
    expect(job?.currentStep).toBe("Step 1");
    // startedAt preserved across re-adds.
    expect(job?.startedAt).toBe(originalStartedAt);
    // size still 1 (no duplicates).
    expect(usePipelineStore.getState().jobs.size).toBe(1);
  });
});

describe("usePipelineStore — updateJob", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "extraction",
    });
  });

  it("is a no-op for unknown jobIds", () => {
    usePipelineStore.getState().updateJob("unknown", { progress: 50 });
    expect(usePipelineStore.getState().jobs.get("unknown")).toBeUndefined();
  });

  it("updates progress and clamps it", () => {
    usePipelineStore.getState().updateJob("j-1", { progress: 50 });
    expect(usePipelineStore.getState().jobs.get("j-1")?.progress).toBe(50);
    usePipelineStore.getState().updateJob("j-1", { progress: 200 });
    expect(usePipelineStore.getState().jobs.get("j-1")?.progress).toBe(100);
  });

  it("flips isComplete when status becomes 'completed'", () => {
    usePipelineStore
      .getState()
      .updateJob("j-1", { status: "completed", progress: 100 });
    expect(usePipelineStore.getState().jobs.get("j-1")?.isComplete).toBe(true);
    expect(usePipelineStore.getState().jobs.get("j-1")?.hasFailed).toBe(false);
  });

  it("flips hasFailed when status becomes 'failed'", () => {
    usePipelineStore
      .getState()
      .updateJob("j-1", { status: "failed", error: "Network down" });
    expect(usePipelineStore.getState().jobs.get("j-1")?.hasFailed).toBe(true);
    expect(usePipelineStore.getState().jobs.get("j-1")?.error).toBe("Network down");
  });

  it("updates lastProgressAt when progress changes", async () => {
    const original = usePipelineStore.getState().jobs.get("j-1")?.lastProgressAt;
    // Wait a tiny bit to guarantee a different timestamp.
    await new Promise((r) => setTimeout(r, 5));
    usePipelineStore.getState().updateJob("j-1", { progress: 10 });
    const next = usePipelineStore.getState().jobs.get("j-1")?.lastProgressAt;
    expect(next).toBeGreaterThan(original ?? 0);
  });

  it("does NOT update lastProgressAt when progress is unchanged", () => {
    usePipelineStore.getState().updateJob("j-1", { progress: 0 });
    const before = usePipelineStore.getState().jobs.get("j-1")?.lastProgressAt;
    usePipelineStore.getState().updateJob("j-1", { currentStep: "Same step" });
    const after = usePipelineStore.getState().jobs.get("j-1")?.lastProgressAt;
    expect(after).toBe(before);
  });
});

describe("usePipelineStore — dismiss / undismiss / remove", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
  });

  it("dismissJob flips the dismissed flag (UI-only)", () => {
    usePipelineStore.getState().dismissJob("j-1");
    expect(usePipelineStore.getState().jobs.get("j-1")?.dismissed).toBe(true);
  });

  it("undismissJob re-shows a dismissed job", () => {
    usePipelineStore.getState().dismissJob("j-1");
    usePipelineStore.getState().undismissJob("j-1");
    expect(usePipelineStore.getState().jobs.get("j-1")?.dismissed).toBe(false);
  });

  it("removeJob drops the job from the map", () => {
    usePipelineStore.getState().removeJob("j-1");
    expect(usePipelineStore.getState().jobs.get("j-1")).toBeUndefined();
  });
});

describe("usePipelineStore — hydrateJobs", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });

  it("adds a batch of jobs in one call", () => {
    usePipelineStore.getState().hydrateJobs([
      { jobId: "seg", courseId: "c-1", phase: "segmentation", status: "completed", progress: 100 },
      { jobId: "ext", courseId: "c-1", phase: "extraction", status: "running", progress: 30 },
    ]);
    const jobs = usePipelineStore.getState().jobs;
    expect(jobs.size).toBe(2);
    expect(jobs.get("seg")?.isComplete).toBe(true);
    expect(jobs.get("ext")?.isComplete).toBe(false);
  });

  it("merges into an existing job (server overwrites status/progress)", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "extraction",
      progress: 10,
    });
    usePipelineStore.getState().hydrateJobs([
      {
        jobId: "j-1",
        courseId: "c-1",
        phase: "extraction",
        status: "running",
        progress: 75,
      },
    ]);
    const job = usePipelineStore.getState().jobs.get("j-1");
    expect(job?.progress).toBe(75);
  });

  it("hydrates lastProgressAt from the input (so stuck detection works after a reload)", () => {
    const tenMinAgo = Date.now() - 10 * 60_000;
    usePipelineStore.getState().hydrateJobs([
      {
        jobId: "j-stuck",
        courseId: "c-1",
        phase: "segmentation",
        status: "running",
        progress: 8,
        lastProgressAt: tenMinAgo,
      },
    ]);
    const job = usePipelineStore.getState().jobs.get("j-stuck");
    expect(job?.lastProgressAt).toBe(tenMinAgo);
  });

  it("is a no-op when given an empty list", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    const before = usePipelineStore.getState().jobs.size;
    usePipelineStore.getState().hydrateJobs([]);
    expect(usePipelineStore.getState().jobs.size).toBe(before);
  });
});

describe("usePipelineStore — reset", () => {
  it("clears all jobs", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().reset();
    expect(usePipelineStore.getState().jobs.size).toBe(0);
  });
});

describe("getActiveJobs", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });

  it("excludes dismissed jobs", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().dismissJob("j-1");
    const active = getActiveJobs(usePipelineStore.getState());
    expect(active).toHaveLength(0);
  });

  // Regression: completed jobs must STAY in the active list so the
  // user sees confirmation that the pipeline finished (and the banner
  // doesn't vanish on a 200 ms empty pipeline). The X button is the
  // only way to hide a completed banner.
  it("KEEPS completed jobs visible (banner stays until user dismisses)", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "tree-building",
      status: "completed",
      progress: 100,
    });
    const active = getActiveJobs(usePipelineStore.getState());
    expect(active).toHaveLength(1);
    expect(active[0]?.isComplete).toBe(true);
  });

  it("returns running and failed jobs", () => {
    usePipelineStore.getState().addJob({
      jobId: "running",
      courseId: "c-1",
      phase: "extraction",
      status: "running",
      progress: 30,
    });
    usePipelineStore.getState().addJob({
      jobId: "failed",
      courseId: "c-1",
      phase: "extraction",
      status: "failed",
      error: "Boom",
    });
    const active = getActiveJobs(usePipelineStore.getState());
    expect(active).toHaveLength(2);
  });

  it("sorts by startedAt ascending (oldest first)", async () => {
    usePipelineStore.getState().addJob({
      jobId: "newer",
      courseId: "c-1",
      phase: "extraction",
    });
    await new Promise((r) => setTimeout(r, 5));
    usePipelineStore.getState().addJob({
      jobId: "older",
      courseId: "c-1",
      phase: "segmentation",
    });
    const active = getActiveJobs(usePipelineStore.getState());
    // Wait — addJob uses Date.now() so the second one is the newer.
    // The first one added (newer) has the older startedAt.
    expect(active[0]?.jobId).toBe("newer");
    expect(active[1]?.jobId).toBe("older");
  });

  it("flags jobs stuck beyond STUCK_THRESHOLD_MS without progress", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
      status: "running",
    });
    // Backdate lastProgressAt to simulate a job that has been silent
    // for longer than the threshold.
    const state = usePipelineStore.getState();
    const job = state.jobs.get("j-1");
    if (job) {
      usePipelineStore.setState({
        jobs: new Map([
          [
            "j-1",
            {
              ...job,
              lastProgressAt: Date.now() - (STUCK_THRESHOLD_MS + 1000),
            },
          ],
        ]),
      });
    }
    const active = getActiveJobs(usePipelineStore.getState());
    expect(active).toHaveLength(1);
    expect(active[0]?.isStuck).toBe(true);
  });

  it("does NOT flag a job that recently changed progress", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
      status: "running",
    });
    const active = getActiveJobs(usePipelineStore.getState());
    expect(active[0]?.isStuck).toBe(false);
  });
});

describe("usePipelineStore — prune / bounded map (Fase 4 estado saneado)", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });

  it("keeps the map at or below MAX_JOBS after adding more than the cap", () => {
    const store = usePipelineStore.getState();
    // Add MAX_JOBS + 50 completed jobs.
    for (let i = 0; i < MAX_JOBS + 50; i++) {
      store.addJob({
        jobId: `done-${i}`,
        courseId: "c-1",
        phase: "segmentation",
        status: "completed",
        progress: 100,
        startedAt: i, // ascending: lower i = older
      });
    }
    expect(usePipelineStore.getState().jobs.size).toBeLessThanOrEqual(MAX_JOBS);
  });

  it("NEVER evicts in-flight (running/pending) jobs, even past the cap", () => {
    const store = usePipelineStore.getState();
    // Seed a handful of running jobs (must survive).
    for (let i = 0; i < 10; i++) {
      store.addJob({
        jobId: `run-${i}`,
        courseId: "c-1",
        phase: "extraction",
        status: "running",
        startedAt: i,
      });
    }
    // Flood with completed jobs to force eviction.
    for (let i = 0; i < MAX_JOBS + 100; i++) {
      store.addJob({
        jobId: `done-${i}`,
        courseId: "c-1",
        phase: "segmentation",
        status: "completed",
        progress: 100,
        startedAt: 1000 + i,
      });
    }
    const jobs = usePipelineStore.getState().jobs;
    expect(jobs.size).toBeLessThanOrEqual(MAX_JOBS);
    // All 10 running jobs are still present.
    for (let i = 0; i < 10; i++) {
      expect(jobs.get(`run-${i}`)?.status).toBe("running");
    }
  });

  it("evicts dismissed jobs before non-dismissed terminal ones", () => {
    const store = usePipelineStore.getState();
    // Fill exactly to the cap with completed (non-dismissed) jobs.
    for (let i = 0; i < MAX_JOBS; i++) {
      store.addJob({
        jobId: `keep-${i}`,
        courseId: "c-1",
        phase: "segmentation",
        status: "completed",
        progress: 100,
        startedAt: 1000 + i, // newer than the dismissed one below
      });
    }
    // Add one dismissed job (oldest) — this pushes size to cap+1.
    store.addJob({
      jobId: "dismissed-old",
      courseId: "c-1",
      phase: "segmentation",
      status: "completed",
      progress: 100,
      startedAt: 0,
    });
    store.dismissJob("dismissed-old");
    // Trigger a prune by adding one more.
    store.addJob({
      jobId: "trigger",
      courseId: "c-1",
      phase: "segmentation",
      status: "completed",
      progress: 100,
      startedAt: 9999,
    });
    // The dismissed job is evicted first.
    expect(usePipelineStore.getState().jobs.has("dismissed-old")).toBe(false);
  });
});

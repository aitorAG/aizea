import { describe, it, expect, beforeEach } from "vitest";
import { usePipelineStore } from "@/lib/stores/usePipelineStore";

describe("usePipelineStore — job timing", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });

  it("addJob sets startedAt to a recent timestamp", () => {
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

  it("addJob sets lastProgressAt to a recent timestamp", () => {
    const before = Date.now();
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    const after = Date.now();
    const job = usePipelineStore.getState().jobs.get("j-1");
    expect(job?.lastProgressAt).toBeGreaterThanOrEqual(before);
    expect(job?.lastProgressAt).toBeLessThanOrEqual(after);
  });

  it("re-adding the same job preserves the original startedAt", async () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    const original = usePipelineStore.getState().jobs.get("j-1")?.startedAt;
    await new Promise((r) => setTimeout(r, 5));
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
      progress: 50,
    });
    expect(usePipelineStore.getState().jobs.get("j-1")?.startedAt).toBe(original);
  });

  it("reset clears all jobs", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().reset();
    expect(usePipelineStore.getState().jobs.size).toBe(0);
  });
});

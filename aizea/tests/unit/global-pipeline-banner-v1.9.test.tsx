// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalPipelineBanner } from "@/components/PipelineProgress/GlobalPipelineBanner";
import {
  usePipelineStore,
  getActiveJobs,
  getBannerGroups,
  groupKeyForJob,
  type ActiveJobView,
  type BannerGroup,
} from "@/lib/stores/usePipelineStore";

vi.mock("@/lib/actions/pipeline", () => ({
  getJobStatusAction: vi.fn(),
  listActiveJobsAction: vi.fn(),
  cancelPipelineAction: vi.fn(),
}));

import {
  getJobStatusAction,
  listActiveJobsAction,
  cancelPipelineAction,
} from "@/lib/actions/pipeline";

const mockGetJobStatus = vi.mocked(getJobStatusAction);
const mockListActiveJobs = vi.mocked(listActiveJobsAction);
const mockCancelPipeline = vi.mocked(cancelPipelineAction);

vi.mock("@/components/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

let mockPathname = "/courses/00000000-0000-0000-0000-000000000001/tree";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockListActiveJobs.mockResolvedValue({ ok: true, jobs: [] });
  mockCancelPipeline.mockResolvedValue({
    ok: true,
    jobId: "any",
    status: "cancelled",
  });
  mockPathname = "/courses/00000000-0000-0000-0000-000000000001/tree";
  usePipelineStore.getState().reset();
});

afterEach(() => {
  cleanup();
  usePipelineStore.getState().reset();
  vi.useRealTimers();
});

// --- v1.9 / Issue 1+2: store-level runId grouping ---------------------

describe("usePipelineStore — runId grouping (v1.9 / Issue 1+2)", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });

  it("groups 4 phase jobs with the same runId into ONE BannerGroup", () => {
    // Simulate the post-await state of a "Generar árbol" click:
    // 4 phase jobs all sharing the same client runId.
    const runId = "run-1";
    usePipelineStore.getState().addJob({
      jobId: "seg-1",
      runId,
      courseId: "c-1",
      phase: "segmentation",
      status: "completed",
      progress: 100,
    });
    usePipelineStore.getState().addJob({
      jobId: "ext-1",
      runId,
      courseId: "c-1",
      phase: "extraction",
      status: "running",
      progress: 30,
    });
    usePipelineStore.getState().addJob({
      jobId: "int-1",
      runId,
      courseId: "c-1",
      phase: "integration",
      status: "pending",
      progress: 0,
    });
    usePipelineStore.getState().addJob({
      jobId: "tree-1",
      runId,
      courseId: "c-1",
      phase: "tree-building",
      status: "pending",
      progress: 0,
    });

    const groups = getBannerGroups(usePipelineStore.getState());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.groupKey).toBe(`run:${runId}`);
    expect(groups[0]?.jobIds).toHaveLength(4);
  });

  it("falls back to courseId when runId is missing (server-hydrated jobs)", () => {
    // 4 phase jobs hydrated from the server, all sharing the same
    // courseId but no runId (the server doesn't know about our
    // client-side UUID). The banner must still collapse them
    // into 1 banner per course.
    usePipelineStore.getState().addJob({
      jobId: "seg-2",
      courseId: "c-2",
      phase: "segmentation",
      status: "completed",
    });
    usePipelineStore.getState().addJob({
      jobId: "ext-2",
      courseId: "c-2",
      phase: "extraction",
      status: "running",
    });
    usePipelineStore.getState().addJob({
      jobId: "int-2",
      courseId: "c-2",
      phase: "integration",
      status: "pending",
    });
    usePipelineStore.getState().addJob({
      jobId: "tree-2",
      courseId: "c-2",
      phase: "tree-building",
      status: "pending",
    });

    const groups = getBannerGroups(usePipelineStore.getState());
    expect(groups).toHaveLength(1);
    expect(groups[0]?.groupKey).toBe("course:c-2");
    expect(groups[0]?.jobIds).toHaveLength(4);
  });

  it("renders ONE banner per group, not one per phase job", () => {
    // 4 jobs, 2 different runIds → 2 banners.
    usePipelineStore.getState().addJob({
      jobId: "seg-A",
      runId: "run-A",
      courseId: "c-1",
      phase: "segmentation",
      status: "completed",
    });
    usePipelineStore.getState().addJob({
      jobId: "ext-A",
      runId: "run-A",
      courseId: "c-1",
      phase: "extraction",
      status: "running",
    });
    usePipelineStore.getState().addJob({
      jobId: "int-A",
      runId: "run-A",
      courseId: "c-1",
      phase: "integration",
      status: "pending",
    });
    usePipelineStore.getState().addJob({
      jobId: "tree-A",
      runId: "run-A",
      courseId: "c-1",
      phase: "tree-building",
      status: "pending",
    });
    // Different runId → second banner.
    usePipelineStore.getState().addJob({
      jobId: "seg-B",
      runId: "run-B",
      courseId: "c-2",
      phase: "segmentation",
      status: "running",
    });

    const groups = getBannerGroups(usePipelineStore.getState());
    expect(groups).toHaveLength(2);
    // Both groups should be sorted by their earliest startedAt
    // (oldest first).
    expect(groups[0]?.groupKey).toBe("run:run-A");
    expect(groups[1]?.groupKey).toBe("run:run-B");
  });

  it("picks the running job as the group representative", () => {
    usePipelineStore.getState().addJob({
      jobId: "seg",
      runId: "run-X",
      courseId: "c-1",
      phase: "segmentation",
      status: "completed",
      progress: 100,
      startedAt: 1000,
    });
    usePipelineStore.getState().addJob({
      jobId: "ext",
      runId: "run-X",
      courseId: "c-1",
      phase: "extraction",
      status: "running",
      progress: 50,
      startedAt: 2000,
    });
    usePipelineStore.getState().addJob({
      jobId: "intg",
      runId: "run-X",
      courseId: "c-1",
      phase: "integration",
      status: "pending",
      progress: 0,
      startedAt: 3000,
    });
    usePipelineStore.getState().addJob({
      jobId: "tree",
      runId: "run-X",
      courseId: "c-1",
      phase: "tree-building",
      status: "pending",
      progress: 0,
      startedAt: 4000,
    });

    const groups = getBannerGroups(usePipelineStore.getState());
    expect(groups).toHaveLength(1);
    // The "running" job wins over "completed" / "pending" — even
    // though `intg` and `tree` have later startedAt, they are
    // still pending and the user cares about what's actively
    // happening right now.
    expect(groups[0]?.representative.jobId).toBe("ext");
    expect(groups[0]?.representative.phase).toBe("extraction");
  });

  it("dismissByGroupKey dismisses every member of the group", () => {
    const runId = "run-D";
    usePipelineStore.getState().addJob({
      jobId: "d-1",
      runId,
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "d-2",
      runId,
      courseId: "c-1",
      phase: "extraction",
    });
    usePipelineStore.getState().addJob({
      jobId: "d-3",
      runId,
      courseId: "c-1",
      phase: "integration",
    });
    usePipelineStore.getState().addJob({
      jobId: "d-4",
      runId,
      courseId: "c-1",
      phase: "tree-building",
    });

    expect(getActiveJobs(usePipelineStore.getState())).toHaveLength(4);
    usePipelineStore.getState().dismissByGroupKey(`run:${runId}`);

    // Every member is now dismissed → banner shows 0 groups.
    expect(getBannerGroups(usePipelineStore.getState())).toHaveLength(0);
    for (const id of ["d-1", "d-2", "d-3", "d-4"]) {
      expect(usePipelineStore.getState().jobs.get(id)?.dismissed).toBe(true);
    }
  });

  it("removeByGroupKey drops every member of the group", () => {
    const runId = "run-R";
    usePipelineStore.getState().addJob({
      jobId: "r-1",
      runId,
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "r-2",
      runId,
      courseId: "c-1",
      phase: "extraction",
    });
    usePipelineStore.getState().addJob({
      jobId: "r-other",
      runId: "run-OTHER",
      courseId: "c-1",
      phase: "segmentation",
    });

    usePipelineStore.getState().removeByGroupKey(`run:${runId}`);

    // The two `run-R` members are gone; the other group is
    // untouched.
    expect(usePipelineStore.getState().jobs.has("r-1")).toBe(false);
    expect(usePipelineStore.getState().jobs.has("r-2")).toBe(false);
    expect(usePipelineStore.getState().jobs.has("r-other")).toBe(true);
  });

  it("groupKeyForJob prefers runId over courseId", () => {
    expect(
      groupKeyForJob({ jobId: "x", runId: "r-1", courseId: "c-1" })
    ).toBe("run:r-1");
    expect(
      groupKeyForJob({ jobId: "x", courseId: "c-1" })
    ).toBe("course:c-1");
    expect(groupKeyForJob({ jobId: "x" })).toBe("orphan:x");
    expect(groupKeyForJob({})).toBe("orphan:unknown");
  });

  it("addJob with a missing runId leaves the existing runId alone", () => {
    usePipelineStore.getState().addJob({
      jobId: "m-1",
      runId: "run-keep",
      courseId: "c-1",
      phase: "segmentation",
    });
    // Re-merge without runId: the existing runId must stick,
    // otherwise the job would silently re-orphan from its run.
    usePipelineStore.getState().addJob({
      jobId: "m-1",
      phase: "segmentation",
      progress: 25,
    });
    expect(usePipelineStore.getState().jobs.get("m-1")?.runId).toBe(
      "run-keep"
    );
  });
});

// --- v1.9 / Issue 1: synchronous placeholder flow ---------------------

describe("<GlobalPipelineBanner /> — v1.9 / Issue 1: synchronous placeholder", () => {
  it("renders a banner immediately when a placeholder is added (no async wait)", () => {
    // Simulate the "I just clicked Generar árbol" frame: a
    // placeholder job is in the store BEFORE the server action
    // has returned. The banner must mount on the very next render
    // so the user sees feedback in <1s.
    usePipelineStore.getState().addJob({
      jobId: "pending:abc-uuid",
      runId: "abc-uuid",
      courseId: "c-1",
      courseName: "Termodinámica",
      phase: "segmentation",
      status: "pending",
      progress: 0,
      currentStep: "Iniciando pipeline…",
    });
    render(<GlobalPipelineBanner />);
    // No await: the banner is visible on the very first frame.
    const banner = screen.getByTestId("global-pipeline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute("data-status")).toBe("active");
    expect(banner.getAttribute("data-group-key")).toBe("run:abc-uuid");
  });

  it("keeps the banner row continuous when the placeholder is replaced with real phase jobs", () => {
    // Simulate the transition: placeholder → 4 real jobs, all
    // sharing the same runId. The banner must NOT show 5 banners
    // at any moment — group continuity is what hides the swap.
    const runId = "abc-uuid";
    usePipelineStore.getState().addJob({
      jobId: "pending:abc-uuid",
      runId,
      courseId: "c-1",
      courseName: "Termodinámica",
      phase: "segmentation",
      status: "pending",
    });

    const { rerender } = render(<GlobalPipelineBanner />);
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(1);

    // Now: action returned, remove placeholder, add 4 real jobs.
    act(() => {
      usePipelineStore.getState().removeJob("pending:abc-uuid");
      usePipelineStore.getState().addJob({
        jobId: "seg-real",
        runId,
        courseId: "c-1",
        courseName: "Termodinámica",
        phase: "segmentation",
        status: "running",
        progress: 10,
      });
      usePipelineStore.getState().addJob({
        jobId: "ext-real",
        runId,
        courseId: "c-1",
        courseName: "Termodinámica",
        phase: "extraction",
        status: "pending",
        progress: 0,
      });
      usePipelineStore.getState().addJob({
        jobId: "int-real",
        runId,
        courseId: "c-1",
        courseName: "Termodinámica",
        phase: "integration",
        status: "pending",
        progress: 0,
      });
      usePipelineStore.getState().addJob({
        jobId: "tree-real",
        runId,
        courseId: "c-1",
        courseName: "Termodinámica",
        phase: "tree-building",
        status: "pending",
        progress: 0,
      });
    });
    rerender(<GlobalPipelineBanner />);

    // CRITICAL: still 1 banner (not 5, not 4). The runId keeps
    // the group together across the placeholder→real swap.
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(1);
    // The banner is now showing the running job (segmentation) as
    // the representative.
    const banner = screen.getByTestId("global-pipeline-banner");
    expect(banner.getAttribute("data-group-key")).toBe(`run:${runId}`);
    expect(banner.getAttribute("data-group-size")).toBe("4");
    expect(banner.getAttribute("data-job-id")).toBe("seg-real");
  });

  it("dismissing a group banner hides all 4 phase jobs at once", async () => {
    // v1.9 / Issue 2 — the user clicks X on the single banner
    // and the whole pipeline run disappears, not just one phase.
    const runId = "run-dismiss";
    usePipelineStore.getState().addJob({
      jobId: "seg-d",
      runId,
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "ext-d",
      runId,
      courseId: "c-1",
      phase: "extraction",
    });
    usePipelineStore.getState().addJob({
      jobId: "int-d",
      runId,
      courseId: "c-1",
      phase: "integration",
    });
    usePipelineStore.getState().addJob({
      jobId: "tree-d",
      runId,
      courseId: "c-1",
      phase: "tree-building",
    });
    render(<GlobalPipelineBanner />);
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(1);

    await userEvent.click(
      screen.getByRole("button", { name: /cerrar banner/i })
    );

    // All 4 are dismissed in one click — no banner visible.
    expect(screen.queryAllByTestId("global-pipeline-banner")).toHaveLength(0);
    for (const id of ["seg-d", "ext-d", "int-d", "tree-d"]) {
      expect(usePipelineStore.getState().jobs.get(id)?.dismissed).toBe(true);
    }
  });
});

// --- v1.9 / Issue 2: stacking regression guard -------------------------

describe("<GlobalPipelineBanner /> — v1.9 / Issue 2: no stacking", () => {
  it("does NOT stack 4 banners for a single 4-phase pipeline run", () => {
    // 4 jobs, all the same runId, same course → 1 banner.
    const runId = "single-run";
    for (const [phase, jobId] of [
      ["segmentation", "j-seg"],
      ["extraction", "j-ext"],
      ["integration", "j-int"],
      ["tree-building", "j-tree"],
    ] as const) {
      usePipelineStore.getState().addJob({
        jobId,
        runId,
        courseId: "c-stack",
        phase,
      });
    }
    render(<GlobalPipelineBanner />);
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(1);
  });

  it("does NOT stack 4 banners for a server-hydrated course (no runId)", () => {
    // 4 jobs, no runId, same course → still 1 banner (courseId
    // fallback).
    for (const [phase, jobId] of [
      ["segmentation", "k-seg"],
      ["extraction", "k-ext"],
      ["integration", "k-int"],
      ["tree-building", "k-tree"],
    ] as const) {
      usePipelineStore.getState().addJob({
        jobId,
        courseId: "c-hydrated",
        phase,
      });
    }
    render(<GlobalPipelineBanner />);
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(1);
  });

  it("renders one banner per RUN (different runIds → different banners)", () => {
    // Two concurrent pipeline runs in different courses → 2 banners.
    usePipelineStore.getState().addJob({
      jobId: "a-1",
      runId: "run-A",
      courseId: "c-A",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "a-2",
      runId: "run-A",
      courseId: "c-A",
      phase: "extraction",
    });
    usePipelineStore.getState().addJob({
      jobId: "b-1",
      runId: "run-B",
      courseId: "c-B",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "b-2",
      runId: "run-B",
      courseId: "c-B",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(2);
  });

  it("updates the visible phase as the orchestrator advances (in-place, not stacked)", () => {
    // Segmentación → Extracción → Integración → Jerarquización:
    // each transition must update the SAME banner row, not stack
    // a new one.
    const runId = "run-walk";
    usePipelineStore.getState().addJob({
      jobId: "w-seg",
      runId,
      courseId: "c-walk",
      phase: "segmentation",
      status: "running",
    });
    const { rerender } = render(<GlobalPipelineBanner />);
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(1);

    // Phase advances: seg completes, extraction starts.
    act(() => {
      usePipelineStore.getState().updateJob("w-seg", {
        status: "completed",
        progress: 100,
      });
      usePipelineStore.getState().addJob({
        jobId: "w-ext",
        runId,
        courseId: "c-walk",
        phase: "extraction",
        status: "running",
      });
    });
    rerender(<GlobalPipelineBanner />);
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(1);

    // Phase advances again: extraction completes, integration starts.
    act(() => {
      usePipelineStore.getState().updateJob("w-ext", {
        status: "completed",
        progress: 100,
      });
      usePipelineStore.getState().addJob({
        jobId: "w-int",
        runId,
        courseId: "c-walk",
        phase: "integration",
        status: "running",
      });
    });
    rerender(<GlobalPipelineBanner />);
    expect(screen.getAllByTestId("global-pipeline-banner")).toHaveLength(1);

    // The visible representative is now the integration job.
    const banner = screen.getByTestId("global-pipeline-banner");
    expect(banner.getAttribute("data-job-id")).toBe("w-int");
    expect(banner.getAttribute("data-group-size")).toBe("3");
  });
});

// --- existing semantics: per-job view still works ---------------------

describe("usePipelineStore — getActiveJobs (legacy per-job view)", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });

  it("returns the raw per-job view (4 jobs for 1 run, NOT grouped)", () => {
    // v1.9 keeps getActiveJobs as the flat per-job view for code
    // that legitimately needs it (polling loop, completion
    // toasts). The grouping lives in getBannerGroups, which the
    // banner now consumes.
    usePipelineStore.getState().addJob({
      jobId: "a",
      runId: "r",
      courseId: "c",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "b",
      runId: "r",
      courseId: "c",
      phase: "extraction",
    });
    usePipelineStore.getState().addJob({
      jobId: "c",
      runId: "r",
      courseId: "c",
      phase: "integration",
    });
    usePipelineStore.getState().addJob({
      jobId: "d",
      runId: "r",
      courseId: "c",
      phase: "tree-building",
    });
    expect(getActiveJobs(usePipelineStore.getState())).toHaveLength(4);
  });
});

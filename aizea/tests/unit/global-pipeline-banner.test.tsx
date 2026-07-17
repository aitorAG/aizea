// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobalPipelineBanner } from "@/components/PipelineProgress/GlobalPipelineBanner";
import { usePipelineStore } from "@/lib/stores/usePipelineStore";

// --- Mocks ---------------------------------------------------------------

vi.mock("@/lib/actions/pipeline", () => ({
  getJobStatusAction: vi.fn(),
  listActiveJobsAction: vi.fn(),
  cancelPipelineAction: vi.fn(),
}));

import { getJobStatusAction, listActiveJobsAction, cancelPipelineAction } from "@/lib/actions/pipeline";
const mockGetJobStatus = vi.mocked(getJobStatusAction);
const mockListActiveJobs = vi.mocked(listActiveJobsAction);
const mockCancelPipeline = vi.mocked(cancelPipelineAction);

vi.mock("@/components/toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no jobs to hydrate (each test can override).
  mockListActiveJobs.mockResolvedValue({ ok: true, jobs: [] });
  mockCancelPipeline.mockResolvedValue({
    ok: true,
    jobId: "any",
    status: "cancelled",
  });
  usePipelineStore.getState().reset();
});

afterEach(() => {
  cleanup();
  usePipelineStore.getState().reset();
  vi.useRealTimers();
});

// Helper: drive the polling timer forward with fake timers and let
// the async fetcher settle. This mirrors how the production code
// behaves: a 2.5 s setInterval fires, then awaits per-job poll calls.
async function flushOnePoll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_500);
  });
}

// --- Tests ---------------------------------------------------------------

describe("<GlobalPipelineBanner /> — visibility", () => {
  it("renders nothing when there is no active job", async () => {
    const { container } = render(<GlobalPipelineBanner />);
    // Wait for the hydration effect to settle (it runs on mount).
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders one banner per active job", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "job-2",
      courseId: "c-2",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const banners = screen.getAllByTestId("global-pipeline-banner");
    expect(banners).toHaveLength(2);
  });

  it("does not render a banner for dismissed jobs", () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().dismissJob("job-1");
    const { container } = render(<GlobalPipelineBanner />);
    expect(container.firstChild).toBeNull();
  });

  // Regression: completed jobs must STAY in the banner so the user
  // sees confirmation that the pipeline finished. The banner only
  // disappears when the user clicks the X button (dismiss).
  it("KEEPS a banner for completed jobs until the user dismisses it", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-done",
      courseId: "c-1",
      phase: "tree-building",
      status: "completed",
      progress: 100,
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const banner = screen.getByTestId("global-pipeline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute("data-status")).toBe("completed");
  });
});

describe("<GlobalPipelineBanner /> — hydration on mount", () => {
  it("calls listActiveJobsAction once on mount and hydrates the store", async () => {
    mockListActiveJobs.mockResolvedValue({
      ok: true,
      jobs: [
        {
          jobId: "from-server-1",
          courseId: "c-1",
          phase: "segmentation",
          status: "running",
          progress: 25,
          currentStep: "In progress",
          error: null,
          startedAt: Date.now() - 30_000,
          updatedAt: Date.now(),
        },
      ],
    });

    render(<GlobalPipelineBanner />);

    // The hydration effect runs on mount; let the microtask + promise
    // resolve.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(mockListActiveJobs).toHaveBeenCalledTimes(1);
    const job = usePipelineStore.getState().jobs.get("from-server-1");
    expect(job).toBeDefined();
    expect(job?.phase).toBe("segmentation");
    expect(job?.progress).toBe(25);
  });

  it("renders the banner for a job that ONLY exists on the server", async () => {
    mockListActiveJobs.mockResolvedValue({
      ok: true,
      jobs: [
        {
          jobId: "from-server-1",
          courseId: "c-1",
          phase: "segmentation",
          status: "running",
          progress: 25,
          currentStep: "In progress",
          error: null,
          startedAt: Date.now() - 30_000,
          updatedAt: Date.now(),
        },
      ],
    });

    render(<GlobalPipelineBanner />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const banner = screen.getByTestId("global-pipeline-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute("data-job-id")).toBe("from-server-1");
  });

  it("tolerates listActiveJobsAction returning ok:false", async () => {
    mockListActiveJobs.mockResolvedValue({ ok: false, error: "DB down" });
    const { container } = render(<GlobalPipelineBanner />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    // No banner (no jobs hydrated), no crash.
    expect(container.firstChild).toBeNull();
  });
});

describe("<GlobalPipelineBanner /> — content", () => {
  it("displays the four phase names", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText(/segmentando/i)).toBeInTheDocument();
    expect(screen.getByText(/extrayendo/i)).toBeInTheDocument();
    expect(screen.getByText(/integrando/i)).toBeInTheDocument();
    expect(screen.getByText(/jerarquizando/i)).toBeInTheDocument();
  });

  it("marks earlier phases as completed and the current one as active", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "integration",
    });
    usePipelineStore.getState().updateJob("job-1", { progress: 50 });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const phases = screen.getAllByTestId("phase");
    const statuses = phases.map((p) => p.getAttribute("data-status"));
    expect(statuses).toEqual(["completed", "completed", "active", "pending"]);
  });

  it("shows the current percentage", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "extraction",
    });
    usePipelineStore.getState().updateJob("job-1", { progress: 42 });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
  });

  it("shows the elapsed time formatted as M:SS for short jobs", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "extraction",
      startedAt: Date.now() - 10_000,
    });
    usePipelineStore.getState().updateJob("job-1", { progress: 5 });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("elapsed-time")).toHaveTextContent(/0:10/);
  });

  it("hides the ETA while progress is 0", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("eta-time")).toBeNull();
  });
});

describe("<GlobalPipelineBanner /> — close button", () => {
  it("renders a close button with a clear label per banner", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "job-2",
      courseId: "c-2",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const buttons = screen.getAllByRole("button", { name: /cerrar banner/i });
    expect(buttons).toHaveLength(2);
  });

  it("clicking the close button on one banner only hides that banner", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "job-2",
      courseId: "c-2",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const banners = screen.getAllByTestId("global-pipeline-banner");
    expect(banners).toHaveLength(2);

    const buttons = screen.getAllByRole("button", { name: /cerrar banner/i });
    await userEvent.click(buttons[0]);

    const remaining = screen.getAllByTestId("global-pipeline-banner");
    expect(remaining).toHaveLength(1);
    // The remaining banner is the one that wasn't dismissed.
    expect(remaining[0].getAttribute("data-job-id")).toBe("job-2");
  });

  it("dismissing a banner only flips the local flag (job stays in the store)", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    await userEvent.click(
      screen.getByRole("button", { name: /cerrar banner/i })
    );
    // Job is still in the store, just marked dismissed.
    const job = usePipelineStore.getState().jobs.get("job-1");
    expect(job).toBeDefined();
    expect(job?.dismissed).toBe(true);
  });
});

describe("<GlobalPipelineBanner /> — stacking", () => {
  it("renders multiple banners in document order with data-banner-index", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "job-2",
      courseId: "c-2",
      phase: "extraction",
    });
    usePipelineStore.getState().addJob({
      jobId: "job-3",
      courseId: "c-3",
      phase: "tree-building",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const stack = screen.getByTestId("global-pipeline-banner-stack");
    expect(stack).toBeInTheDocument();
    expect(stack.getAttribute("data-count")).toBe("3");
    const banners = screen.getAllByTestId("global-pipeline-banner");
    expect(banners.map((b) => b.getAttribute("data-banner-index"))).toEqual([
      "0",
      "1",
      "2",
    ]);
  });
});

describe("<GlobalPipelineBanner /> — polling", () => {
  it("polls every active job via getJobStatusAction", async () => {
    mockGetJobStatus.mockResolvedValue({
      ok: true,
      job: {
        id: "job-1",
        phase: "segmentation",
        status: "running",
        progress: 25,
        total: 100,
        currentStep: "Step 1",
        error: null,
        courseId: "c-1",
        materialId: null,
      },
    });
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "job-2",
      courseId: "c-2",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    // The banner fires pollAll() immediately on mount (and again
    // every 2.5 s). Real timers + a short wait is enough to observe
    // at least the first call.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // Both jobs should have been polled.
    expect(mockGetJobStatus).toHaveBeenCalledWith("job-1");
    expect(mockGetJobStatus).toHaveBeenCalledWith("job-2");
  });

  it("updates the store from each tick while a job is still running", async () => {
    mockGetJobStatus.mockResolvedValue({
      ok: true,
      job: {
        id: "job-1",
        phase: "extraction",
        status: "running",
        progress: 30,
        total: 100,
        currentStep: "Unit 3/10",
        error: null,
        courseId: "c-1",
        materialId: null,
      },
    });
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const job = usePipelineStore.getState().jobs.get("job-1");
    expect(job?.progress).toBe(30);
    expect(job?.currentStep).toBe("Unit 3/10");
  });

  it("marks the banner as failed when the job status is failed", async () => {
    mockGetJobStatus.mockResolvedValue({
      ok: true,
      job: {
        id: "job-1",
        phase: "extraction",
        status: "failed",
        progress: 40,
        total: 100,
        currentStep: null,
        error: "Boom",
        courseId: "c-1",
        materialId: null,
      },
    });
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const banner = screen.getByTestId("global-pipeline-banner");
    expect(banner.getAttribute("data-status")).toBe("failed");
    expect(usePipelineStore.getState().jobs.get("job-1")?.hasFailed).toBe(true);
  });

  it("stays visible when getJobStatusAction returns ok:false (transient blip)", async () => {
    mockGetJobStatus.mockResolvedValue({ ok: false, error: "API down" });
    usePipelineStore.getState().addJob({
      jobId: "job-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    // The banner stays visible.
    expect(screen.getByTestId("global-pipeline-banner")).toBeInTheDocument();
    // The job is NOT marked as failed (transient errors shouldn't
    // trigger the failed UI).
    expect(usePipelineStore.getState().jobs.get("job-1")?.hasFailed).toBe(false);
  });
});

describe("<GlobalPipelineBanner /> — stuck detection", () => {
  it("flags a job that has been silent past the stuck threshold", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-stuck",
      courseId: "c-1",
      phase: "segmentation",
      status: "running",
    });
    // Backdate lastProgressAt to simulate a job that has been silent.
    const job = usePipelineStore.getState().jobs.get("job-stuck");
    if (job) {
      usePipelineStore.setState({
        jobs: new Map([
            [
              "job-stuck",
              {
                ...job,
                lastProgressAt: Date.now() - (6 * 60 * 1000),
              },
            ],
          ]),
      });
    }
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const banner = screen.getByTestId("global-pipeline-banner");
    expect(banner.getAttribute("data-stuck")).toBe("true");
    expect(banner.getAttribute("data-status")).toBe("failed");
  });

  it("shows the retry button for a failed job", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-fail",
      courseId: "c-1",
      phase: "extraction",
      status: "failed",
      error: "Boom",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("banner-retry")).toBeInTheDocument();
  });
});

describe("<GlobalPipelineBanner /> — stop button (cancel job)", () => {
  it("renders a Stop button for each running job", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-running-1",
      courseId: "c-1",
      phase: "segmentation",
    });
    usePipelineStore.getState().addJob({
      jobId: "job-running-2",
      courseId: "c-2",
      phase: "extraction",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const stops = screen.getAllByTestId("banner-stop");
    expect(stops).toHaveLength(2);
  });

  it("does NOT render a Stop button for completed jobs", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-done",
      courseId: "c-1",
      phase: "extraction",
      status: "completed",
      progress: 100,
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("banner-stop")).toBeNull();
  });

  it("does NOT render a Stop button for already-failed jobs", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-fail",
      courseId: "c-1",
      phase: "extraction",
      status: "failed",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("banner-stop")).toBeNull();
  });

  it("does NOT render a Stop button for already-cancelled jobs", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-cancelled",
      courseId: "c-1",
      phase: "extraction",
      status: "cancelled",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId("banner-stop")).toBeNull();
  });

  it("clicking Stop calls cancelPipelineAction and updates the local store", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-to-cancel",
      courseId: "c-1",
      phase: "extraction",
      progress: 30,
      currentStep: "Unit 3/10",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });

    await userEvent.click(screen.getByTestId("banner-stop"));

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCancelPipeline).toHaveBeenCalledWith("job-to-cancel");
    const job = usePipelineStore.getState().jobs.get("job-to-cancel");
    expect(job?.status).toBe("cancelled");
  });

  it("shows a cancelled banner with a distinct status attribute", async () => {
    usePipelineStore.getState().addJob({
      jobId: "job-cancelled-2",
      courseId: "c-1",
      phase: "extraction",
      status: "cancelled",
    });
    render(<GlobalPipelineBanner />);
    await act(async () => {
      await Promise.resolve();
    });
    const banner = screen.getByTestId("global-pipeline-banner");
    expect(banner.getAttribute("data-status")).toBe("cancelled");
  });
});

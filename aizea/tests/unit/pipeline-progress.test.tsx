// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { PipelineProgress } from "@/components/PipelineProgress/PipelineProgress";
import { usePipelineStore } from "@/lib/stores/usePipelineStore";

describe("<PipelineProgress />", () => {
  beforeEach(() => {
    usePipelineStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
  });

  it("renders the four pipeline phases", () => {
    render(<PipelineProgress />);
    expect(screen.getByText(/segmentando/i)).toBeDefined();
    expect(screen.getByText(/extrayendo/i)).toBeDefined();
    expect(screen.getByText(/integrando/i)).toBeDefined();
    expect(screen.getByText(/jerarquizando/i)).toBeDefined();
  });

  it("marks every phase as 'pending' when no job is running", () => {
    render(<PipelineProgress />);
    const phases = screen.getAllByTestId("phase");
    expect(phases).toHaveLength(4);
    for (const p of phases) {
      expect(p.getAttribute("data-status")).toBe("pending");
    }
  });

  it("marks a phase as 'active' when the job says it is current", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "extraction",
      progress: 50,
    });
    render(<PipelineProgress />);
    const phases = screen.getAllByTestId("phase");
    const active = phases.find((p) => p.getAttribute("data-status") === "active");
    expect(active).toBeDefined();
    expect(active).toHaveTextContent(/extrayendo/i);
  });

  it("marks earlier phases as 'completed' and later as 'pending'", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "integration",
      progress: 60,
    });
    render(<PipelineProgress />);
    const phases = screen.getAllByTestId("phase");
    const statuses = phases.map((p) => p.getAttribute("data-status"));
    // segmentation + extraction done, integration active, tree-building pending
    expect(statuses).toEqual([
      "completed",
      "completed",
      "active",
      "pending",
    ]);
  });

  it("shows the current percentage (0-100)", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "extraction",
      progress: 42,
    });
    render(<PipelineProgress />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("42");
  });

  it("renders the error list when the job has an error", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "extraction",
      status: "failed",
      error: "Fallo segmentando",
    });
    render(<PipelineProgress />);
    expect(screen.getByText(/fallo segmentando/i)).toBeDefined();
  });

  it("does not render the error list when there is no error", () => {
    render(<PipelineProgress />);
    expect(screen.queryByTestId("error-list")).toBeNull();
  });

  it("shows the current step text from the store", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "extraction",
      currentStep: "Unidad 7/12",
    });
    render(<PipelineProgress />);
    expect(screen.getByText(/unidad 7\/12/i)).toBeDefined();
  });

  it("shows a 'completado' badge when the job is at 100%", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "tree-building",
      status: "completed",
      progress: 100,
    });
    render(<PipelineProgress />);
    expect(screen.getByText(/completado/i)).toBeDefined();
  });

  it("shows a failed badge when the job is failed", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-1",
      courseId: "c-1",
      phase: "extraction",
      status: "failed",
      error: "Boom",
    });
    render(<PipelineProgress />);
    expect(screen.getByTestId("pipeline-progress-failed")).toBeDefined();
  });

  it("scopes the sidebar to the explicit jobId prop when provided", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-other",
      courseId: "c-other",
      phase: "extraction",
      progress: 30,
      currentStep: "Other job",
    });
    usePipelineStore.getState().addJob({
      jobId: "j-mine",
      courseId: "c-mine",
      phase: "integration",
      progress: 60,
      currentStep: "My job",
    });
    render(<PipelineProgress jobId="j-mine" />);
    // The progress bar reflects j-mine (60), not j-other (30).
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("60");
    // The data attribute on the root is also the explicit jobId.
    expect(screen.getByTestId("pipeline-progress").getAttribute("data-job-id")).toBe(
      "j-mine"
    );
  });

  it("falls back to the first non-dismissed job when no jobId is provided", () => {
    usePipelineStore.getState().addJob({
      jobId: "j-only",
      courseId: "c-1",
      phase: "tree-building",
      progress: 88,
    });
    render(<PipelineProgress />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("88");
  });
});

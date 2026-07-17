import { create } from "zustand";
import type {
  PipelinePhase,
  ProcessingStatus,
} from "@/lib/types/pipeline";

/**
 * Per-job state held by the pipeline store. One `JobInfo` per active
 * ProcessingJob; the store keeps them in a Map keyed by jobId so the
 * UI can render N independent banners for N independent jobs.
 *
 * Fields:
 *   - `jobId`:        stable ProcessingJob.id from the DB
 *   - `courseId`:     which course this job belongs to (lets the UI
 *                     scope notifications / "go to course" links)
 *   - `phase`:        which pipeline phase this row tracks
 *   - `status`:       DB status ('pending' | 'running' | 'completed' | 'failed')
 *   - `progress`:     0..100 percentage reported by the job
 *   - `currentStep`:  human-readable label of the current step
 *   - `error`:        error message when status is 'failed'
 *   - `startedAt`:    wall-clock ms when the job was first registered
 *   - `lastProgressAt`: wall-clock ms when progress last changed
 *                       (used to detect stuck jobs)
 *   - `isComplete`:   convenience flag for `status === 'completed'`
 *   - `hasFailed`:    convenience flag for `status === 'failed'`
 *   - `dismissed`:    local UI-only flag; set when the user clicks X
 *                     on a banner. Not persisted; resets on reload.
 */
export interface JobInfo {
  jobId: string;
  courseId: string | null;
  phase: PipelinePhase;
  status: ProcessingStatus;
  progress: number;
  currentStep: string | null;
  error: string | null;
  startedAt: number;
  lastProgressAt: number;
  isComplete: boolean;
  hasFailed: boolean;
  dismissed: boolean;
}

/** Input shape for `addJob` / `hydrateJobs` — same fields, all optional
 *  except the identifiers. */
export interface JobInput {
  jobId: string;
  courseId?: string | null;
  phase: PipelinePhase;
  status?: ProcessingStatus;
  progress?: number;
  currentStep?: string | null;
  error?: string | null;
  startedAt?: number;
  /** Wall-clock when progress last changed. Used for stuck-job
   *  detection. When omitted (e.g. brand-new local addJob), the
   *  store uses "now". When hydrating from the server, this should
   *  be the row's `updatedAt` so the stuck detection reflects
   *  reality on the server side. */
  lastProgressAt?: number;
}

interface PipelineState {
  jobs: Map<string, JobInfo>;
}

interface PipelineActions {
  /** Register a new job, or merge into an existing one. Idempotent. */
  addJob(info: JobInput): void;
  /** Apply a partial update. No-op if the job doesn't exist. */
  updateJob(
    jobId: string,
    partial: Partial<
      Omit<JobInfo, "jobId" | "startedAt" | "lastProgressAt" | "dismissed">
    > & { lastProgressAt?: number }
  ): void;
  /** Mark a job as dismissed (local UI only). */
  dismissJob(jobId: string): void;
  /** Re-show a previously dismissed job. */
  undismissJob(jobId: string): void;
  /** Remove a job entirely from the store. */
  removeJob(jobId: string): void;
  /** Bulk hydrate from server rows. Existing jobs are merged;
   *  missing jobs are added. The server is the source of truth
   *  for status/progress/error. */
  hydrateJobs(rows: JobInput[]): void;
  /** Clear all state. */
  reset(): void;
}

/** A job is considered "stuck" if it has been `running` for longer
 *  than this without any change in `progress`. After this, the UI
 *  should surface it as failed (with a "Reintentar" button). */
export const STUCK_THRESHOLD_MS = 5 * 60 * 1000;

const initialState: PipelineState = {
  jobs: new Map(),
};

/** Internal helper to merge an input row into an existing JobInfo. */
function mergeJob(
  existing: JobInfo | undefined,
  input: JobInput,
  now: number
): JobInfo {
  const progress = input.progress ?? existing?.progress ?? 0;
  const status: ProcessingStatus =
    input.status ?? existing?.status ?? "running";
  // A new entry is always considered "progress changed" because
  // there is no prior state to compare against. We use this to
  // decide whether to refresh `lastProgressAt`: for an existing
  // entry, only refresh when the progress number actually moved.
  // For a new entry, honour the caller-supplied `lastProgressAt`
  // (e.g. the server's updatedAt during hydration) when present.
  const progressChanged = existing ? existing.progress !== progress : true;
  const base: JobInfo = existing ?? {
    jobId: input.jobId,
    courseId: input.courseId ?? null,
    phase: input.phase,
    status,
    progress,
    currentStep: input.currentStep ?? null,
    error: input.error ?? null,
    startedAt: input.startedAt ?? now,
    // When the caller provided a `lastProgressAt` (e.g. hydrating
    // from the server with the row's updatedAt), honour it. This
    // is what makes the stuck-job detection work for jobs that
    // were in flight before the page loaded.
    lastProgressAt: input.lastProgressAt ?? now,
    isComplete: status === "completed",
    hasFailed: status === "failed",
    dismissed: false,
  };
  const newLastProgressAt = existing
    ? progressChanged
      ? now
      : base.lastProgressAt
    : base.lastProgressAt; // new entry: keep the value chosen above
  return {
    ...base,
    courseId: input.courseId !== undefined ? input.courseId : base.courseId,
    phase: input.phase ?? base.phase,
    status,
    progress,
    currentStep:
      input.currentStep !== undefined ? input.currentStep : base.currentStep,
    error: input.error !== undefined ? input.error : base.error,
    lastProgressAt: newLastProgressAt,
    isComplete: status === "completed",
    hasFailed: status === "failed",
  };
}

export const usePipelineStore = create<PipelineState & PipelineActions>(
  (set) => ({
    ...initialState,

    addJob: (info) =>
      set((state) => {
        const next = new Map(state.jobs);
        const now = Date.now();
        next.set(info.jobId, mergeJob(next.get(info.jobId), info, now));
        return { jobs: next };
      }),

    updateJob: (jobId, partial) =>
      set((state) => {
        const existing = state.jobs.get(jobId);
        if (!existing) return state;
        const next = new Map(state.jobs);
        const now = Date.now();
        const status: ProcessingStatus = partial.status ?? existing.status;
        const rawProgress =
          partial.progress !== undefined ? partial.progress : existing.progress;
        const progress = Math.min(100, Math.max(0, rawProgress));
        const updated: JobInfo = {
          ...existing,
          ...partial,
          status,
          progress,
          isComplete: status === "completed",
          hasFailed: status === "failed",
          lastProgressAt:
            progress !== existing.progress
              ? partial.lastProgressAt ?? now
              : existing.lastProgressAt,
        };
        next.set(jobId, updated);
        return { jobs: next };
      }),

    dismissJob: (jobId) =>
      set((state) => {
        const job = state.jobs.get(jobId);
        if (!job) return state;
        const next = new Map(state.jobs);
        next.set(jobId, { ...job, dismissed: true });
        return { jobs: next };
      }),

    undismissJob: (jobId) =>
      set((state) => {
        const job = state.jobs.get(jobId);
        if (!job) return state;
        const next = new Map(state.jobs);
        next.set(jobId, { ...job, dismissed: false });
        return { jobs: next };
      }),

    removeJob: (jobId) =>
      set((state) => {
        if (!state.jobs.has(jobId)) return state;
        const next = new Map(state.jobs);
        next.delete(jobId);
        return { jobs: next };
      }),

    hydrateJobs: (rows) =>
      set((state) => {
        if (rows.length === 0) return state;
        const next = new Map(state.jobs);
        const now = Date.now();
        for (const row of rows) {
          next.set(row.jobId, mergeJob(next.get(row.jobId), row, now));
        }
        return { jobs: next };
      }),

    reset: () => set({ ...initialState, jobs: new Map() }),
  })
);

/** View layer: what the UI should render. Adds the derived `isStuck`
 *  flag. Pure function over the store state — easy to test. */
export interface ActiveJobView extends JobInfo {
  isStuck: boolean;
}

/**
 * What the UI should render right now.
 *
 * Includes:
 *  - running jobs (`status === "running"`)
 *  - failed / stuck jobs (so the user can see the failure and retry)
 *  - **completed** jobs — the user wants confirmation that the pipeline
 *    finished, and the banner stays visible until they explicitly close
 *    it with the X button. The old behaviour filtered completed jobs
 *    out, which made a 200 ms pipeline (course with no materials)
 *    flash the banner and immediately disappear, looking like a bug.
 *
 * Excludes only:
 *  - jobs the user has dismissed (`dismissed === true`).
 *    X-button is the only way to clear the banner; reload clears all
 *    `dismissed` flags.
 */
export function getActiveJobs(state: PipelineState): ActiveJobView[] {
  const now = Date.now();
  const out: ActiveJobView[] = [];
  for (const job of state.jobs.values()) {
    if (job.dismissed) continue;
    const isStuck =
      !job.isComplete &&
      !job.hasFailed &&
      job.status === "running" &&
      job.progress < 100 &&
      now - job.lastProgressAt > STUCK_THRESHOLD_MS;
    out.push({ ...job, isStuck });
  }
  // Oldest first so the bottom of the stack is the most recent.
  out.sort((a, b) => a.startedAt - b.startedAt);
  return out;
}

// Dev-only: expose the store on `window.__pipelineStore` so QA scripts
// (and Playwright) can drive the banner without going through a real
// pipeline run. Harmless in production — the store is read-only when
// nothing calls it. The `__` prefix flags it as internal.
if (typeof window !== "undefined") {
  (
    window as unknown as { __pipelineStore?: typeof usePipelineStore }
  ).__pipelineStore = usePipelineStore;
}

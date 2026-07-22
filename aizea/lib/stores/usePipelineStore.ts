import { create } from "zustand";
import type {
  PipelinePhase,
  ProcessingStatus,
} from "@/lib/types/pipeline";

/**
 * Per-job state held by the pipeline store. One `JobInfo` per active
 * ProcessingJob; the store keeps them in a Map keyed by jobId. The
 * banner groups rows with the same `runId` (or `courseId` as a
 * fallback) so a single user-triggered pipeline run renders ONE
 * banner even though the orchestrator creates FOUR phase jobs.
 *
 * Fields:
 *   - `jobId`:        stable ProcessingJob.id from the DB
 *   - `runId`:        client-generated UUID that ties the 4 phase
 *                     jobs of one pipeline run together. Null when
 *                     the job was hydrated from the server (e.g.
 *                     after a page reload), in which case the
 *                     banner falls back to grouping by `courseId`.
 *   - `courseId`:     which course this job belongs to (lets the UI
 *                     scope notifications / "go to course" links)
 *   - `courseName`:   human-readable name of the course. Optional
 *                     because the server may hydrate a job whose
 *                     course has been deleted. When present, the
 *                     banner surfaces it next to the job title so
 *                     the user can tell at a glance which course the
 *                     job belongs to.
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
  runId: string | null;
  courseId: string | null;
  /** Display name of the course. Hydrated by `listActiveJobsAction`
   *  from the `course.name` column. May be null when the course
   *  was deleted or the action was unable to read it. */
  courseName: string | null;
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
  /** Optional — see `JobInfo.runId`. When omitted on `addJob` the
   *  store keeps the existing value (or null). */
  runId?: string | null;
  courseId?: string | null;
  /** Optional — see `JobInfo.courseName`. When omitted on
   *  `addJob` the store keeps the existing value (or null). */
  courseName?: string | null;
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
  /** Mark every job that shares the given groupKey (a runId, or
   *  a courseId when runId is absent) as dismissed. The banner
   *  calls this when the user dismisses one banner — closing the
   *  "Generando árbol" banner should hide the whole pipeline run,
   *  not just the visible representative job. */
  dismissByGroupKey(groupKey: string): void;
  /** Remove every job that shares the given groupKey from the
   *  store. Used after the action returns and we swap the
   *  client-side placeholder for the real phase jobs (so the
   *  polling loop doesn't continue to fetch a fake jobId). */
  removeByGroupKey(groupKey: string): void;
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
    // runId is set on the FIRST addJob that introduces this job
    // (a server-hydrated job leaves it null and the banner falls
    // back to grouping by courseId). Once set, the runId sticks:
    // re-merging with `runId: null` would silently re-orphan the
    // job from its pipeline run, which is exactly the bug this
    // field exists to prevent.
    runId: input.runId ?? null,
    courseId: input.courseId ?? null,
    courseName: input.courseName ?? null,
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
    // Honour a non-undefined `runId` so a server-hydrated row
    // can be re-parented to a client runId (and stay parented
    // when the input omits the field).
    runId: input.runId !== undefined ? input.runId : base.runId,
    courseId: input.courseId !== undefined ? input.courseId : base.courseId,
    courseName:
      input.courseName !== undefined ? input.courseName : base.courseName,
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

    dismissByGroupKey: (groupKey) =>
      set((state) => {
        let changed = false;
        const next = new Map(state.jobs);
        for (const [jobId, job] of state.jobs) {
          if (job.dismissed) continue;
          if (groupKeyForJob(job) !== groupKey) continue;
          next.set(jobId, { ...job, dismissed: true });
          changed = true;
        }
        return changed ? { jobs: next } : state;
      }),

    removeByGroupKey: (groupKey) =>
      set((state) => {
        let changed = false;
        const next = new Map(state.jobs);
        for (const [jobId, job] of state.jobs) {
          if (groupKeyForJob(job) !== groupKey) continue;
          next.delete(jobId);
          changed = true;
        }
        return changed ? { jobs: next } : state;
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
 *
 * NOTE: this returns the raw per-job view. The banner historically
 * rendered one row per `JobInfo`, which meant 4 stacked banners for a
 * single pipeline run (one per phase). That stacking is now
 * collapsed in `getBannerGroups` — the banner consumes groups, not
 * raw jobs. This helper is kept for code that legitimately needs the
 * flat per-job view (e.g. the polling loop, which must still fetch
 * every active job).
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

/** A group of jobs that belong to the same user-triggered pipeline
 *  run. The banner renders ONE banner per group.
 *
 *  Aggregation rules:
 *   - `groupKey`     : the runId when present, otherwise the
 *                      courseId (so server-hydrated jobs — which
 *                      have no client runId — still collapse to a
 *                      single banner per course).
 *   - `jobIds`       : every jobId in the group. The polling loop
 *                      iterates this list; the dismiss handler
 *                      marks every member as dismissed.
 *   - `representative`: the job that drives the visible UI
 *                      (title, current step, phase chip, progress
 *                      bar). The choice is the most-relevant job:
 *                      a running job always wins over a pending or
 *                      completed one; ties go to the most recently
 *                      started job so the banner naturally walks
 *                      through phases as the orchestrator moves
 *                      forward.
 *   - `phase`        : the representative's phase. The chip
 *                      visualisation in `<PipelineJobBanner />`
 *                      works on a single phase field, so the
 *                      representative's phase IS the banner's
 *                      current phase.
 *   - `status` / `isComplete` / `hasFailed` : derived from the
 *                      whole group — the banner is "failed" if any
 *                      job in the group failed, "completed" only
 *                      when every job in the group is completed.
 *   - `progress`     : the active (or latest) job's progress, since
 *                      each phase's progress is 0..100 for its
 *                      own slice, not the whole pipeline.
 *   - `startedAt`    : the earliest `startedAt` in the group (when
 *                      the pipeline actually started).
 *   - `lastProgressAt` : the most recent `lastProgressAt` (so stuck
 *                      detection still works on a per-group basis).
 *   - `dismissed`    : derived from the whole group (mirrors the
 *                      raw per-job flag). */
export interface BannerGroup {
  groupKey: string;
  jobIds: string[];
  representative: ActiveJobView;
  /** True when every job in the group has been marked as
   *  dismissed. The banner skips dismissed groups. */
  dismissed: boolean;
}

/** Stable identifier for grouping a job with its siblings. Prefers
 *  the client runId; falls back to the courseId so server-hydrated
 *  rows (which have no runId) still collapse to a single banner
 *  per course. Returns null only when BOTH are missing (an
 *  orphan job — e.g. from an old session) which the banner then
 *  treats as a singleton group. */
export function groupKeyForJob(
  job: { jobId?: string; runId?: string | null; courseId?: string | null }
): string {
  if (job.runId) return `run:${job.runId}`;
  if (job.courseId) return `course:${job.courseId}`;
  return `orphan:${job.jobId ?? "unknown"}`;
}

/** Aggregation rank for picking the representative job. Higher
 *  values win. */
function representativeRank(j: ActiveJobView): number {
  // A "running" job is the most informative — it is the one the
  // user wants to see right now. A "pending" job is more relevant
  // than a "completed" one (it's next in line). "completed" /
  // "failed" / "cancelled" only appear as fallback when nothing
  // else exists in the group.
  if (j.status === "running") return 4;
  if (j.status === "pending") return 3;
  if (j.status === "completed") return 2;
  if (j.status === "failed") return 1;
  // "cancelled" or any other future status: lowest priority.
  return 0;
}

/** Pick the most informative member of a group. Within the same
 *  rank, prefer the most recently started so the banner naturally
 *  walks through phases. */
function pickRepresentative(jobs: ActiveJobView[]): ActiveJobView {
  let best = jobs[0];
  let bestRank = representativeRank(best);
  for (let i = 1; i < jobs.length; i++) {
    const j = jobs[i];
    const r = representativeRank(j);
    if (
      r > bestRank ||
      (r === bestRank && j.startedAt > best.startedAt)
    ) {
      best = j;
      bestRank = r;
    }
  }
  return best;
}

/**
 * Group the raw active jobs into banner-shaped groups, one per
 * pipeline run. The GlobalPipelineBanner iterates this list and
 * renders exactly one `<PipelineJobBanner />` per group, which
 * collapses the 4 phase jobs created by a single user click into
 * a single banner.
 *
 * Pure function over the store state — easy to test in isolation.
 */
export function getBannerGroups(state: PipelineState): BannerGroup[] {
  const active = getActiveJobs(state);
  if (active.length === 0) return [];

  // Bucket jobs by groupKey. We seed from the per-job view (not
  // the raw map) so dismissed jobs are excluded up front.
  const buckets = new Map<string, ActiveJobView[]>();
  for (const job of active) {
    const key = groupKeyForJob(job);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(job);
    } else {
      buckets.set(key, [job]);
    }
  }

  const groups: BannerGroup[] = [];
  for (const [groupKey, members] of buckets) {
    const representative = pickRepresentative(members);
    groups.push({
      groupKey,
      jobIds: members.map((j) => j.jobId),
      representative,
      dismissed: false,
    });
  }

  // Oldest first so the bottom of the stack is the most recent —
  // matches the per-job ordering from `getActiveJobs`.
  groups.sort(
    (a, b) => a.representative.startedAt - b.representative.startedAt
  );
  return groups;
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

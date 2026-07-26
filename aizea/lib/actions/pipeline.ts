"use server";

// Server actions for the pipeline orchestrator.
//
// These are thin adapters: they translate the `ProcessCourseOutcome`
// discriminated union from the use case into a stable wire shape the
// client (tree-client.tsx) already understands. The business logic
// — including the intelligent "do I have materials? do I have units?
// should I read the file from disk?" reasoning — lives in
// `lib/application/use-cases/process-course.use-case.ts` and is
// tested independently of Next.js, the DB, and the filesystem.

import { container } from "@/lib/composition/container";
import { revalidatePath } from "next/cache";

export type StartPipelineResult =
  | {
      ok: true;
      /** True when the pipeline had nothing to do. The client
       *  surfaces `message` as a toast. */
      empty: true;
      reason: "NO_MATERIALS";
      message: string;
    }
  | {
      ok: true;
      /** Fase 2.2 — el run se ENCOLÓ y se ejecuta en el worker de fondo.
       *  El pipeline ya no bloquea el request. El cliente descubre las
       *  filas de fase vía `listActiveJobsAction` (polling del banner). */
      empty: false;
      enqueued: true;
      runId: string;
    }
  | { ok: false; error: string };

/**
 * Start a new pipeline run for the given course.
 *
 * Delegates to the `ProcessCourseUseCase`, which:
 *   1. Checks whether the course has any materials.
 *   2. Checks whether any of them have already been segmented.
 *   3. If neither, reads the latest material from disk and re-runs
 *      the pipeline with the buffer (so the segmenter has bytes to
 *      work on, even if docling-serve is down — the segmenter has
 *      its own text-only fallback).
 *
 * Returns the same wire shape the previous action returned, plus a
 * new `reason` field for the empty case so the UI can distinguish
 * "no materials at all" from "file missing on disk" if it wants
 * to surface more specific copy.
 */
export async function startPipelineAction(
  courseId: string
): Promise<StartPipelineResult> {
  // Verify the course exists. A missing course is a 404.
  const courseExists = await container.courses.exists(courseId);
  if (!courseExists) {
    return { ok: false, error: "Curso no encontrado." };
  }

  // Fase 2.2 — fast NO_MATERIALS guard, kept SYNCHRONOUS so the user gets an
  // immediate "upload a PDF" toast without spinning up a background run. The
  // deeper empty cases (FILE_MISSING / ALL_EMPTY / ALL_FAILED) require running
  // segmentation, which now happens in the worker; they surface via the
  // in-app notifier + the banner's failed/empty phase rows.
  const materials = await container.materials.findByCourseId(courseId);
  if (materials.length === 0) {
    return {
      ok: true,
      empty: true,
      reason: "NO_MATERIALS",
      message: "Sube un PDF antes de generar el árbol.",
    };
  }

  // Enqueue the run and kick the worker WITHOUT awaiting it: the pipeline now
  // executes outside the request cycle (the core of Fase 2). `startPipelineAction`
  // returns as soon as the run is persisted; the worker drains the queue and
  // creates the phase rows the banner polls for.
  let runId: string;
  try {
    const run = await container.jobQueue.enqueue({ courseId });
    runId = run.runId;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: message };
  }

  // Fire-and-forget. The worker's pump is reentrant, so concurrent starts are
  // safe. A rejected pump is swallowed here (the run row already records the
  // failure via the worker's markFailed), so we don't crash the request.
  void container.pipelineWorker.pump().catch((err) => {
    console.error("[startPipelineAction] worker pump failed:", err);
  });

  revalidatePath(`/courses/${courseId}`);

  return { ok: true, empty: false, enqueued: true, runId };
}

// --- read-only pipeline actions (unchanged) -----------------------------

export type GetJobStatusResult =
  | {
      ok: true;
      job: {
        id: string;
        phase: string;
        status: string;
        progress: number;
        total: number;
        currentStep: string | null;
        error: string | null;
        courseId: string | null;
        materialId: string | null;
      };
    }
  | { ok: false; error: string };

/** Active job as returned by `listActiveJobsAction`. The shape
 *  matches what the client store expects so the GlobalPipelineBanner
 *  can hydrate the store in a single pass. */
export interface ActiveJob {
  jobId: string;
  courseId: string | null;
  /** Course display name. Hydrated from `course.name` by
   *  `listActiveJobsAction` so the banner can identify which course
   *  a job belongs to without a second round-trip. Null when the
   *  course was deleted or the relation cannot be resolved. */
  courseName: string | null;
  phase: string;
  status: string;
  progress: number;
  currentStep: string | null;
  error: string | null;
  startedAt: number;
  updatedAt: number;
}

export type ListActiveJobsResult =
  | { ok: true; jobs: ActiveJob[] }
  | { ok: false; error: string };

/**
 * Look up the current state of a ProcessingJob for UI polling.
 * Returns ok:false if the job does not exist or the database is unavailable.
 */
export async function getJobStatusAction(
  jobId: string
): Promise<GetJobStatusResult> {
  try {
    const job = await container.processingJobs.findById(jobId);
    if (!job) {
      return { ok: false, error: "Trabajo no encontrado." };
    }
    return {
      ok: true,
      job: {
        id: job.id,
        phase: job.type,
        status: job.status,
        progress: job.progress,
        total: job.total,
        currentStep: job.currentStep,
        error: job.error,
        courseId: job.courseId,
        materialId: job.materialId,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: message };
  }
}

/**
 * How long after a job's last update we still surface it to the
 * banner on a fresh page load. 30 seconds is long enough to cover
 * a normal reload-after-click flow (so a completed/failed banner
 * the user is staring at does NOT vanish on hard refresh), and
 * short enough that historical jobs from previous sessions never
 * reappear after the user navigates away. Issue v1.5 #2.3: users
 * were seeing all historical jobs in the banner on every reload.
 */
const RECENT_JOB_WINDOW_MS = 30 * 1000;

/**
 * Options for `listActiveJobsAction`.
 *
 * - `courseId` (optional): when provided, only jobs for that course
 *   are returned. When omitted, jobs for every course are returned.
 *   The GlobalPipelineBanner passes the current courseId (derived
 *   from the URL pathname) so the banner only ever shows jobs that
 *   belong to the course the user is currently looking at.
 */
export interface ListActiveJobsOptions {
  courseId?: string;
}

/**
 * List the ProcessingJobs the GlobalPipelineBanner should rehydrate
 * after a page reload. Includes:
 *
 *   - `pending` and `running` jobs (in-flight, the original use-case).
 *   - `completed`, `failed`, and `cancelled` jobs updated within the
 *     last `RECENT_JOB_WINDOW_MS` (30s) — so a completed banner the
 *     user is staring at does NOT vanish on a hard refresh, and a
 *     failed/cancelled banner survives a page reload.
 *   - Optionally filtered to a single `courseId` so the banner only
 *     surfaces jobs for the course the user is viewing. This
 *     prevents historical jobs from previous sessions from leaking
 *     into the current view.
 *
 * Ordered by `updatedAt DESC` (newest first) so the most recent
 * activity sits at the top of any downstream list.
 *
 * Returns ok:false only on database failure.
 */
export async function listActiveJobsAction(
  options: ListActiveJobsOptions = {}
): Promise<ListActiveJobsResult> {
  try {
    // The port resolves course names via a relation include and applies
    // the "in-flight OR recently-terminal" window. `terminalStatuses`
    // mode = pending/running (any age) + completed/failed/cancelled
    // within the 30s window. v1.5 #2.3.
    const rows = await container.processingJobs.findRecentWithCourseNames({
      windowMs: RECENT_JOB_WINDOW_MS,
      courseId: options.courseId,
      terminalStatuses: ["completed", "failed", "cancelled"],
    });
    return {
      ok: true,
      jobs: rows.map((row) => ({
        jobId: row.id,
        courseId: row.courseId,
        courseName: row.courseName,
        phase: row.type,
        status: row.status,
        progress: row.progress,
        currentStep: row.currentStep,
        error: row.error,
        startedAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: message };
  }
}

export type CancelPipelineResult =
  | {
      ok: true;
      jobId: string;
      status: "cancelled" | "completed" | "failed";
    }
  | { ok: false; error: string };

// --- v1.11 / Jobs panel — finished jobs and retry ----------------------
//
// The Jobs sidebar / page exposes a "Finalizados" tab that shows jobs
// that are no longer running (completed / failed / cancelled) but
// were recently updated — so the user can see what they just kicked
// off, what failed, and what they cancelled, without scrolling the
// DB. 5 minutes is the same window the dismiss-on-reload window uses
// for the global banner, but a few minutes longer feels right for
// the panel: the user may want to review / retry a job that finished
// a couple of minutes ago.
const FINISHED_JOB_WINDOW_MS = 5 * 60 * 1000;

export type RetryPipelineResult =
  | StartPipelineResult
  | { ok: false; error: string };

/**
 * v1.11 / Jobs panel — re-run the pipeline for the course that owns
 * a given job. The Jobs sidebar / page expose a "Reintentar" button
 * on every failed or completed row; clicking it kicks off a fresh
 * pipeline run for the course the job belongs to.
 *
 * We resolve the job's `courseId` server-side and delegate to the
 * existing `startPipelineAction` so the retry path is the same code
 * as a fresh run. The result is the same `StartPipelineResult` the
 * pipeline already returns (so the client hydrates the store from
 * the new job ids without any shape work).
 */
export async function retryPipelineAction(
  jobId: string
): Promise<RetryPipelineResult> {
  const job = await container.processingJobs.findById(jobId);
  if (!job) {
    return { ok: false, error: "Trabajo no encontrado." };
  }
  if (!job.courseId) {
    return {
      ok: false,
      error: "El trabajo no está asociado a ningún curso.",
    };
  }
  return await startPipelineAction(job.courseId);
}

export type ListFinishedJobsResult =
  | { ok: true; jobs: ActiveJob[] }
  | { ok: false; error: string };

/**
 * v1.11 / Jobs panel — list jobs that are no longer in-flight
 * (completed / failed / cancelled) AND were updated within the last
 * 5 minutes. This is the "Finalizados" tab. Returns rows hydrated
 * with the course name so the UI can group by course without a
 * follow-up round-trip.
 *
 * Optionally scoped to a single course via `options.courseId` so the
 * hover tooltip on the Jobs nav button can show finished jobs for
 * the course the user is currently viewing. The full /jobs page and
 * the sidebar omit the courseId filter so the panel is global.
 */
export async function listFinishedJobsAction(
  options: ListActiveJobsOptions = {}
): Promise<ListFinishedJobsResult> {
  try {
    // `statusFilter` mode = only the given terminal statuses, each
    // constrained to the window (the port applies the `updatedAt`
    // cutoff). No pending/running here — this is the "Finalizados" tab.
    const rows = await container.processingJobs.findRecentWithCourseNames({
      windowMs: FINISHED_JOB_WINDOW_MS,
      courseId: options.courseId,
      statusFilter: ["completed", "failed", "cancelled"],
    });
    return {
      ok: true,
      jobs: rows.map((row) => ({
        jobId: row.id,
        courseId: row.courseId,
        courseName: row.courseName,
        phase: row.type,
        status: row.status,
        progress: row.progress,
        currentStep: row.currentStep,
        error: row.error,
        startedAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      })),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: message };
  }
}

/**
 * Cancel a running ProcessingJob.
 *
 * Idempotent: calling cancel on an already-cancelled / completed /
 * failed job returns ok:true with the current status. This prevents
 * the Stop button from confusingly erroring out when the user
 * double-clicks or the job finished in the time it took the request
 * to land.
 */
export async function cancelPipelineAction(
  jobId: string
): Promise<CancelPipelineResult> {
  try {
    const job = await container.processingJobs.findById(jobId);
    if (!job) {
      return { ok: false, error: "Trabajo no encontrado." };
    }
    if (job.status === "completed") {
      return { ok: true, jobId, status: "completed" };
    }
    if (job.status === "failed") {
      return { ok: true, jobId, status: "failed" };
    }
    if (job.status === "cancelled") {
      return { ok: true, jobId, status: "cancelled" };
    }
    await container.processingJobs.update(jobId, {
      status: "cancelled",
      currentStep: "Cancelado por el usuario",
      error: "Cancelado por el usuario",
    });
    return { ok: true, jobId, status: "cancelled" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: message };
  }
}

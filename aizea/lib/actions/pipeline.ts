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

import { db } from "@/lib/db";
import { container } from "@/lib/composition/container";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import type {
  ProcessCourseOutcome,
} from "@/lib/application/use-cases/process-course.use-case";

export type StartPipelineResult =
  | {
      ok: true;
      /** True when the pipeline had nothing to do. The client
       *  surfaces `message` as a toast. */
      empty: true;
      reason: "NO_MATERIALS" | "FILE_MISSING" | "ALL_EMPTY" | "ALL_FAILED";
      message: string;
      jobs: {
        segmentationJobId: string;
        extractionJobId: string;
        integrationJobId: string;
        treeBuildingJobId: string;
      };
      /** Per-material failures (when the use case reports ALL_FAILED). */
      materialErrors: Array<{ materialId: string; filename: string; error: string }>;
    }
  | {
      ok: true;
      empty: false;
      jobs: {
        segmentationJobId: string;
        extractionJobId: string;
        integrationJobId: string;
        treeBuildingJobId: string;
      };
      /** Number of materials that successfully produced units
       *  (v1.5 #2.5: the user may have uploaded multiple files). */
      processedMaterials: number;
      totalMaterials: number;
      /** Per-material failures. Empty when every file was OK. */
      materialErrors: Array<{ materialId: string; filename: string; error: string }>;
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
  // Verify the course exists. The use case is happy to receive any
  // id, but a missing course is a 404 and we want a clear error.
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) {
    return { ok: false, error: "Curso no encontrado." };
  }

  let outcome: ProcessCourseOutcome;
  try {
    outcome = await container.processCourse.execute(courseId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: message };
  }

  revalidatePath(`/courses/${courseId}`);

  if (!outcome.ok) {
    return { ok: false, error: outcome.error };
  }

  if (outcome.empty) {
    return {
      ok: true,
      empty: true,
      reason: outcome.reason,
      message: outcome.message,
      jobs: outcome.jobs,
      materialErrors: outcome.materialErrors,
    };
  }

  return {
    ok: true,
    empty: false,
    jobs: {
      segmentationJobId: outcome.result.segmentationJobId,
      extractionJobId: outcome.result.extractionJobId,
      integrationJobId: outcome.result.integrationJobId,
      treeBuildingJobId: outcome.result.treeBuildingJobId,
    },
    processedMaterials: outcome.processedMaterials,
    totalMaterials: outcome.totalMaterials,
    materialErrors: outcome.materialErrors,
  };
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
    const job = await db.processingJob.findUnique({ where: { id: jobId } });
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
    const recentCutoff = new Date(Date.now() - RECENT_JOB_WINDOW_MS);
    const orFilters: Prisma.ProcessingJobWhereInput[] = [
      { status: { in: ["pending", "running"] } },
      { status: "completed", updatedAt: { gte: recentCutoff } },
      { status: "failed", updatedAt: { gte: recentCutoff } },
      { status: "cancelled", updatedAt: { gte: recentCutoff } },
    ];
    const where: Prisma.ProcessingJobWhereInput = {
      ...(options.courseId
        ? { AND: [{ OR: orFilters }, { courseId: options.courseId }] }
        : { OR: orFilters }),
    };
    const rows = await db.processingJob.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
    // `ProcessingJob` has no Prisma relation to `Course` (only a
    // raw `courseId` string), so we resolve course names with a
    // follow-up query scoped to the distinct courseIds we just
    // fetched. v1.5 issue 2.1: the banner needs the course name.
    const courseIds = Array.from(
      new Set(
        rows
          .map((row) => row.courseId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    const courses =
      courseIds.length > 0
        ? await db.course.findMany({
            where: { id: { in: courseIds } },
            select: { id: true, name: true },
          })
        : [];
    const courseNameById = new Map<string, string>(
      courses.map((c) => [c.id, c.name])
    );
    return {
      ok: true,
      jobs: rows.map((row) => ({
        jobId: row.id,
        courseId: row.courseId,
        courseName: row.courseId
          ? courseNameById.get(row.courseId) ?? null
          : null,
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
  const job = await db.processingJob.findUnique({
    where: { id: jobId },
    select: { courseId: true },
  });
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
    const cutoff = new Date(Date.now() - FINISHED_JOB_WINDOW_MS);
    const where: Prisma.ProcessingJobWhereInput = {
      status: { in: ["completed", "failed", "cancelled"] },
      updatedAt: { gte: cutoff },
      ...(options.courseId ? { courseId: options.courseId } : {}),
    };
    const rows = await db.processingJob.findMany({
      where,
      orderBy: { updatedAt: "desc" },
    });
    const courseIds = Array.from(
      new Set(
        rows
          .map((row) => row.courseId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );
    const courses =
      courseIds.length > 0
        ? await db.course.findMany({
            where: { id: { in: courseIds } },
            select: { id: true, name: true },
          })
        : [];
    const courseNameById = new Map<string, string>(
      courses.map((c) => [c.id, c.name])
    );
    return {
      ok: true,
      jobs: rows.map((row) => ({
        jobId: row.id,
        courseId: row.courseId,
        courseName: row.courseId
          ? courseNameById.get(row.courseId) ?? null
          : null,
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
    const job = await db.processingJob.findUnique({ where: { id: jobId } });
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
    await db.processingJob.update({
      where: { id: jobId },
      data: {
        status: "cancelled",
        currentStep: "Cancelado por el usuario",
        error: "Cancelado por el usuario",
      },
    });
    return { ok: true, jobId, status: "cancelled" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return { ok: false, error: message };
  }
}

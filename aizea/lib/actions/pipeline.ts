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
import type {
  ProcessCourseOutcome,
} from "@/lib/application/use-cases/process-course.use-case";

export type StartPipelineResult =
  | {
      ok: true;
      /** True when the pipeline had nothing to do. The client
       *  surfaces `message` as a toast. */
      empty: true;
      reason: "NO_MATERIALS" | "FILE_MISSING";
      message: string;
      jobs: {
        segmentationJobId: string;
        extractionJobId: string;
        integrationJobId: string;
        treeBuildingJobId: string;
      };
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

/** How long after a job's last update we still surface it to the
 *  banner on a fresh page load. Long enough to cover a normal
 *  reload-after-click flow, short enough that a job the user closed
 *  yesterday doesn't pop back up tomorrow. */
const RECENT_JOB_WINDOW_MS = 10 * 60 * 1000;

/**
 * List the ProcessingJobs the GlobalPipelineBanner should rehydrate
 * after a page reload. Includes:
 *
 *   - `pending` and `running` jobs (in-flight, the original use-case).
 *   - `completed` and `failed` jobs updated within the last
 *     `RECENT_JOB_WINDOW_MS` — so a completed banner the user is
 *     staring at does NOT vanish on a hard refresh, and a failed
 *     banner survives a page reload.
 *   - `cancelled` jobs updated within the last `RECENT_JOB_WINDOW_MS`
 *     so a banner the user just stopped still shows the cancellation
 *     state across a reload.
 *
 * Returns ok:false only on database failure.
 */
export async function listActiveJobsAction(): Promise<ListActiveJobsResult> {
  try {
    const recentCutoff = new Date(Date.now() - RECENT_JOB_WINDOW_MS);
    const rows = await db.processingJob.findMany({
      where: {
        OR: [
          { status: { in: ["pending", "running"] } },
          { status: "completed", updatedAt: { gte: recentCutoff } },
          { status: "failed", updatedAt: { gte: recentCutoff } },
          { status: "cancelled", updatedAt: { gte: recentCutoff } },
        ],
      },
      orderBy: { updatedAt: "asc" },
    });
    return {
      ok: true,
      jobs: rows.map((row) => ({
        jobId: row.id,
        courseId: row.courseId,
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

import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/pipeline/[jobId]/status
 *
 * Returns the current state of a ProcessingJob for UI polling.
 *
 * Response (200):
 *   {
 *     id, phase, status, progress, total, currentStep, error,
 *     courseId, materialId, createdAt, updatedAt
 *   }
 *
 * Errors:
 *   - 404: the job does not exist
 *   - 500: an internal error occurred (no stack trace is returned)
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  try {
    const { jobId } = await params;
    const job = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json(
        { error: "Trabajo no encontrado" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      id: job.id,
      phase: job.type,
      status: job.status,
      progress: job.progress,
      total: job.total,
      currentStep: job.currentStep,
      error: job.error,
      courseId: job.courseId,
      materialId: job.materialId,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// MOD-04: BullMQ removed. This route now reads the ProcessingJob row via
// the composition root (IProcessingJobRepository).
import { NextResponse } from "next/server";
import { container } from "@/lib/composition/container";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  try {
    const { jobId } = await params;
    const job = await container.processingJobs.findById(jobId);
    if (!job) {
      return NextResponse.json({ error: "Trabajo no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ status: job.status, progress: job.progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

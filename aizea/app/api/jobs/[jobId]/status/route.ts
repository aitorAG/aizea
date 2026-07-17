import { NextResponse } from "next/server";
import { JobQueue } from "@/lib/infrastructure/queue/JobQueue";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  try {
    const { jobId } = await params;
    const queue = new JobQueue();
    const { status, progress } = await queue.getStatus(jobId);
    await queue.close();

    return NextResponse.json({ status, progress });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error interno";
    const statusCode = message === "Trabajo no encontrado" ? 404 : 500;
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}

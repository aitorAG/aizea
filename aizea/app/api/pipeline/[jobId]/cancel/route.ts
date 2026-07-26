// POST /api/pipeline/[jobId]/cancel — cancel a run/phase over HTTP (Fase 3-D).
//
// Thin REST bridge to `cancelPipelineAction` for the Fase 4 SPA. Idempotent:
// cancelling an already-terminal job returns 200 with the current status
// (mirrors the action's contract). The cooperative-cancel path (Fase 2.4)
// picks up the flipped status and stops the extraction loop.
//
// Response: 200 { ok:true, jobId, status } — cancelled (or already terminal)
//           404 { ok:false, error } — job not found
//           500 { ok:false, error } — internal error

import { NextResponse } from "next/server";
import { cancelPipelineAction } from "@/lib/actions/pipeline";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> }
): Promise<NextResponse> {
  const { jobId } = await params;
  const result = await cancelPipelineAction(jobId);

  if (!result.ok) {
    const status = /no encontrado/i.test(result.error) ? 404 : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 200 });
}

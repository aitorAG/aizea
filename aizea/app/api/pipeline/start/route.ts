// POST /api/pipeline/start — enqueue a pipeline run over HTTP (Fase 3-D).
//
// Thin REST bridge to `startPipelineAction`, the same enqueue logic the
// server-action client uses. This exists so the Fase 4 Vite SPA (which has no
// access to Next server actions) can start a run via a plain HTTP call. The
// business logic is NOT duplicated: the route delegates to the action.
//
// Request:  { "courseId": "..." }
// Response: 200 { ok:true, empty:false, enqueued:true, runId } — run queued
//           200 { ok:true, empty:true, reason:"NO_MATERIALS", message } — nothing to do
//           400 { ok:false, error } — bad request (missing courseId)
//           404 { ok:false, error } — course not found
//           500 { ok:false, error } — internal error

import { NextResponse } from "next/server";
import { startPipelineAction } from "@/lib/actions/pipeline";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  let courseId: unknown;
  try {
    const body = await request.json();
    courseId = body?.courseId;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON inválido." },
      { status: 400 }
    );
  }

  if (typeof courseId !== "string" || courseId.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Falta el campo 'courseId'." },
      { status: 400 }
    );
  }

  const result = await startPipelineAction(courseId);

  if (!result.ok) {
    // "Curso no encontrado" → 404; anything else is an internal failure.
    const status = /no encontrado/i.test(result.error) ? 404 : 500;
    return NextResponse.json(result, { status });
  }

  return NextResponse.json(result, { status: 200 });
}

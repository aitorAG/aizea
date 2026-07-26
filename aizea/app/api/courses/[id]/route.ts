// GET /api/courses/[id] — course detail (course + slides + materials + figures)
// PATCH /api/courses/[id] — update name/llmContext
// DELETE /api/courses/[id] — delete course
// Fase 4-A REST bridge to the course server actions for the SPA data layer.

import { NextResponse } from "next/server";
import { getCourse, updateCourse, deleteCourse } from "@/lib/actions/course";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  try {
    const detail = await getCourse(id);
    return NextResponse.json({ ok: true, ...detail }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    // CourseService.getCourse throws when the course is absent.
    const status = /no encontrad|not found|no existe/i.test(message) ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  let body: { name?: unknown; llmContext?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON inválido." },
      { status: 400 }
    );
  }

  const data: { name?: string; llmContext?: string } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { ok: false, error: "'name' debe ser una cadena no vacía." },
        { status: 400 }
      );
    }
    data.name = body.name;
  }
  if (body.llmContext !== undefined) {
    if (typeof body.llmContext !== "string") {
      return NextResponse.json(
        { ok: false, error: "'llmContext' debe ser una cadena." },
        { status: 400 }
      );
    }
    data.llmContext = body.llmContext;
  }
  if (data.name === undefined && data.llmContext === undefined) {
    return NextResponse.json(
      { ok: false, error: "Nada que actualizar." },
      { status: 400 }
    );
  }

  try {
    const course = await updateCourse(id, data);
    return NextResponse.json({ ok: true, course }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    const status = /no encontrad|not found|no existe/i.test(message) ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  try {
    await deleteCourse(id);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    const status = /no encontrad|not found|no existe/i.test(message) ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

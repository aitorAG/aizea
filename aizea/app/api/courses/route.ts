// GET /api/courses — list courses · POST /api/courses — create (Fase 4-A).
//
// REST bridge to the course server actions, so the strangler-fig SPA data
// layer can list/create courses over plain HTTP without server actions.
// Business logic is NOT duplicated: the routes delegate to the actions.

import { NextResponse } from "next/server";
import { getCourses, createCourse } from "@/lib/actions/course";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const courses = await getCourses();
    return NextResponse.json({ ok: true, courses }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  let name: unknown;
  try {
    const body = await request.json();
    name = body?.name;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Cuerpo JSON inválido." },
      { status: 400 }
    );
  }

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json(
      { ok: false, error: "Falta el campo 'name'." },
      { status: 400 }
    );
  }

  try {
    const created = await createCourse(name);
    return NextResponse.json({ ok: true, id: created.id }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { container } from "@/lib/composition/container";
import { ExportService } from "@/lib/application/ExportService";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get("courseId");
    if (!courseId) {
      return NextResponse.json({ error: "Falta courseId" }, { status: 400 });
    }

    const course = await container.courses.findById(courseId);

    if (!course) {
      return NextResponse.json({ error: "Curso no encontrado" }, { status: 404 });
    }

    // ExportService keeps its own Prisma handle (already constructor-injected).
    const exportService = new ExportService(db);
    const html = await exportService.exportToHtml(courseId);

    const filename = `${course.name.replace(/[^a-zA-Z0-9\u00C0-\u017F\s]/g, "").replace(/\s+/g, "_")}_material_docente.html`;

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json({ error: "Error interno" }, { status: 500 });
  }
}

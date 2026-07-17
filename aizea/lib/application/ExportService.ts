import { BoxType } from "@/lib/types";
import type { PrismaClient, SlideBox } from "@prisma/client";

interface SlideWithData {
  title: string;
  description: string;
  order: number;
  htmlDesign: string | null;
  boxContents: Record<string, string>;
}

function getBox(boxes: SlideBox[], type: string): string {
  return boxes.find((b) => b.type === type)?.content ?? "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderSlide(slide: SlideWithData, index: number, total: number): string {
  const html = slide.htmlDesign ?? "";
  const script = slide.boxContents.script ?? "";
  const relevance = slide.boxContents.relevance ?? "";
  const narrative = slide.boxContents.narrative ?? "";

  return `
<div class="page">
  <div class="page-header">
    <span class="page-num">${index + 1} / ${total}</span>
    <h1>${escapeHtml(slide.title)}</h1>
  </div>

  <div class="html-preview">
    ${html || `<div class="no-html">Sin diseño HTML</div>`}
  </div>

  <div class="content-boxes">
    <div class="box">
      <h2>Guion</h2>
      <p>${escapeHtml(script) || "Sin contenido."}</p>
    </div>
    <div class="box">
      <h2>Relevancia</h2>
      <p>${escapeHtml(relevance) || "Sin contenido."}</p>
    </div>
    <div class="box">
      <h2>Narrativa</h2>
      <p>${escapeHtml(narrative) || "Sin contenido."}</p>
    </div>
  </div>
</div>`;
}

export class NotImplementedError extends Error {
  constructor(message: string = "Funcionalidad no implementada") {
    super(message);
    this.name = "NotImplementedError";
  }
}

export class ExportService {
  constructor(private readonly db: PrismaClient) {}

  async exportToHtml(courseId: string): Promise<string> {
    const course = await this.db.course.findUnique({
      where: { id: courseId },
      include: {
        slides: {
          orderBy: { order: "asc" },
          include: { boxes: true },
        },
      },
    });

    if (!course) {
      throw new Error("Curso no encontrado");
    }

    const slides: SlideWithData[] = course.slides.map((s) => ({
      title: s.title,
      description: s.description,
      order: s.order,
      htmlDesign: s.htmlDesign,
      boxContents: {
        script: getBox(s.boxes, BoxType.SCRIPT),
        relevance: getBox(s.boxes, BoxType.RELEVANCE),
        narrative: getBox(s.boxes, BoxType.NARRATIVE),
        exercise1: getBox(s.boxes, BoxType.EXERCISE_1),
        exercise2: getBox(s.boxes, BoxType.EXERCISE_2),
      },
    }));

    const slidesHtml = slides.map((s, i) => renderSlide(s, i, slides.length)).join("");

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>AIzea — ${escapeHtml(course.name)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js"></script>
  <style>
    @page { size: A4; margin: 0; }
    @media print {
      .page { page-break-after: always; min-height: 100vh; }
      .page:last-child { page-break-after: auto; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; font-size: 11pt; line-height: 1.5; color: #1a1a1a; background: #fff; }
    .page { padding: 1.5cm 2cm; min-height: 100vh; display: flex; flex-direction: column; }
    .page-header { border-bottom: 3px solid #1a56db; padding-bottom: 0.5cm; margin-bottom: 0.5cm; }
    .page-num { font-size: 0.8rem; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; }
    .page-header h1 { font-size: 1.6rem; font-weight: 700; margin-top: 0.2cm; color: #111827; }
    .html-preview { flex: 1; padding: 0.3cm 0; overflow: auto; }
    .html-preview > :first-child { width: 100%; height: 100%; }
    .no-html { display: flex; align-items: center; justify-content: center; height: 100%; color: #9ca3af; font-style: italic; }
    .content-boxes { display: flex; flex-direction: column; gap: 0.4cm; padding-top: 0.3cm; border-top: 1px solid #e5e7eb; }
    .box h2 { font-size: 0.85rem; font-weight: 600; color: #1e40af; margin-bottom: 0.15cm; text-transform: uppercase; letter-spacing: 0.03em; }
    .box p { font-size: 0.85rem; color: #374151; white-space: pre-wrap; }
  </style>
</head>
<body>
  ${slidesHtml}
  <script>
    document.addEventListener("DOMContentLoaded", () => {
      if (typeof renderMathInElement === "function") {
        renderMathInElement(document.body, {
          delimiters: [
            {left: "$$", right: "$$", display: true},
            {left: "$", right: "$", display: false}
          ],
          throwOnError: false
        });
      }
    });
  </script>
</body>
</html>`;
  }

  async exportToMarkdown(courseId: string): Promise<string> {
    const course = await this.db.course.findUnique({
      where: { id: courseId },
      include: {
        slides: {
          orderBy: { order: "asc" },
          include: { boxes: true },
        },
      },
    });

    if (!course) {
      throw new Error("Curso no encontrado");
    }

    const lines: string[] = [];
    lines.push(`# ${course.name}`);
    lines.push("");

    for (const slide of course.slides) {
      const script = getBox(slide.boxes, BoxType.SCRIPT);
      const relevance = getBox(slide.boxes, BoxType.RELEVANCE);
      const narrative = getBox(slide.boxes, BoxType.NARRATIVE);

      lines.push(`## ${slide.order + 1}. ${slide.title}`);
      lines.push("");

      if (script) {
        lines.push("**Guion**");
        lines.push("");
        lines.push(script);
        lines.push("");
      }

      if (relevance) {
        lines.push("**Relevancia**");
        lines.push("");
        lines.push(relevance);
        lines.push("");
      }

      if (narrative) {
        lines.push("**Narrativa**");
        lines.push("");
        lines.push(narrative);
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  async exportToPptx(_courseId: string): Promise<never> {
    throw new NotImplementedError("Exportación a PPTX no está implementada");
  }
}

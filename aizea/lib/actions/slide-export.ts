"use server";

/**
 * Slide export server actions.
 *
 * - `exportSlideHtmlAction`  — wraps a single slide's `htmlDesign` in a
 *   complete, standalone HTML document that can be downloaded and opened
 *   in any browser.
 *
 * - `exportSlidesPdfAction`  — renders every slide of a course into a
 *   single multi-page A4 PDF. Each page shows the slide HTML in the
 *   top half (auto-scaled to the printable width) and a structured text
 *   section (Guion / Relevancia / Narrativa) in the bottom half.
 *
 * The PDF generator uses Playwright (already a dev dep) launching the
 * locally-installed Chromium binary. This is the lightest approach
 * available because we do NOT have to install Puppeteer (~300MB of
 * bundled Chrome) and we already have a working Chromium at
 * `%LOCALAPPDATA%\ms-playwright\chromium-1228\`.
 *
 * Pure helpers (string templating, escaping, filename sanitization)
 * live in `slide-export-helpers.ts` because Next.js requires every
 * `export` from a `"use server"` module to be an async function.
 */

import { db } from "@/lib/db";
import { BoxType } from "@/lib/types";
import {
  PdfRenderService,
  PlaywrightUnavailableError,
} from "@/lib/infrastructure/pdf/pdf-render.service";
import {
  BOX_LABELS,
  buildPdfHtml,
  buildStandaloneSlideHtml,
  KATEX_CDN_TAGS,
  sanitizeFilename,
  stripBom,
} from "@/lib/actions/slide-export-helpers";

// Servicio de infraestructura que renderiza HTML→PDF vía Playwright/Chromium.
// La automatización de navegador (antes duplicada en dos actions) vive ahí.
const pdfRenderService = new PdfRenderService();

export interface ExportSlideHtmlResult {
  html: string;
  filename: string;
}

export async function exportSlideHtmlAction(
  slideId: string
): Promise<ExportSlideHtmlResult> {
  const slide = await db.slide.findUnique({
    where: { id: slideId },
    include: { course: { select: { name: true } } },
  });
  if (!slide) throw new Error("Diapositiva no encontrada");
  if (!slide.htmlDesign) {
    throw new Error("La diapositiva aún no tiene diseño HTML generado.");
  }
  // `buildStandaloneSlideHtml` already strips a leading BOM from the
  // title and htmlDesign AND emits `<meta charset="utf-8">` as the
  // first child of `<head>`. We run `stripBom` on the final result
  // too as defense in depth — a leading BOM in the response body
  // would make the browser interpret the document as UTF-8-with-BOM
  // and re-encode everything from byte offset 3, breaking accented
  // characters in some viewers.
  const rawHtml = buildStandaloneSlideHtml({
    title: slide.title,
    htmlDesign: slide.htmlDesign,
  });
  const html = stripBom(rawHtml);
  const filename = `${sanitizeFilename(slide.title)}_${sanitizeFilename(
    slide.course.name
  )}.html`;
  return { html, filename };
}

export interface ExportSlidesPdfResult {
  pdf: string; // base64-encoded (when Playwright available)
  html?: string; // full HTML document (fallback when no Playwright)
  filename: string;
  pageCount: number;
}

export async function exportSlidesPdfAction(
  courseId: string
): Promise<ExportSlidesPdfResult> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { name: true },
  });
  if (!course) throw new Error("Curso no encontrado");

  const slides = await db.slide.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    include: { boxes: true },
  });
  if (slides.length === 0) {
    throw new Error("El curso no tiene diapositivas para exportar.");
  }

  const slidesForPdf = slides.map((s) => {
    const boxes: Record<string, string> = {};
    for (const b of s.boxes) boxes[b.type] = b.content;
    return {
      title: s.title,
      description: s.description,
      htmlDesign: s.htmlDesign,
      boxes,
    };
  });

  const html = stripBom(
    buildPdfHtml({
      courseName: course.name,
      slides: slidesForPdf,
    })
  );

  // El render HTML→PDF (Playwright/Chromium) vive en PdfRenderService.
  const pdfBuffer = await pdfRenderService.renderToPdf(html, {
    format: "A4",
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: "12mm", bottom: "14mm", left: "12mm", right: "12mm" },
  });
  const pdfBase64 = pdfBuffer.toString("base64");
  const filename = `${sanitizeFilename(course.name)}_slides.pdf`;
  return { pdf: pdfBase64, filename, pageCount: slides.length };
}

/**
 * v1.5 / Task 4.3 — Simple "Export PDF" action for the slides list.
 *
 * Renders EVERY slide of the course as ONE full A4 page each. Unlike
 * `exportSlidesPdfAction` (which splits each page top-half/bottom-half
 * with the text boxes), this is the bare minimum that satisfies the
 * user's request: "Exportar a PDF: formato A4. un A4 por slide."
 *
 * Only the slide's `htmlDesign` is included; the structured text
 * boxes (Guion / Relevancia / Narrativa) are intentionally omitted
 * to keep the action minimal. If a richer layout is needed later,
 * reuse `buildPdfHtml` from `slide-export-helpers.ts`.
 */
export async function exportAllSlidesPdfAction(
  courseId: string
): Promise<ExportSlidesPdfResult> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { name: true },
  });
  if (!course) throw new Error("Curso no encontrado");

  const slides = await db.slide.findMany({
    where: { courseId },
    orderBy: { order: "asc" },
    include: { boxes: true },
  });
  if (slides.length === 0) {
    throw new Error("El curso no tiene diapositivas para exportar.");
  }

  // v1.7 / Issue 4.1 + v1.8 / Issue 4.1 — A4 portrait, one slide
  // per page, split 50/50:
  //   .slide-top    → the slide's `htmlDesign` rendered in a 1280x720
  //                    frame, CSS-scaled to fit the A4 width.
  //   .slide-bottom → structured text (Guion / Relevancia / Narrativa)
  //                    rendered as <h3> + <p> blocks, with overflow
  //                    hidden so a long box never bleeds onto the
  //                    following page.
  //
  // v1.8 fix — the previous version centred a 1280x720 element with
  // `transform: scale(0.62)`. The problem: `transform: scale()` does
  // not change the element's LAYOUT box, only its visual rendering.
  // With `display: flex; align-items: center; justify-content: center`
  // the layout box was still 1280px wide, so flex centred its *layout
  // centre* (at 640px) in the 794px container, clipping 243px of
  // slide off the LEFT and 243px off the RIGHT — the user only ever
  // saw the middle ~62% of every slide.
  //
  // The fix is a SCALED WRAPPER (.slide-scaler) sized to the
  // post-scale footprint (1280 * 0.62 ≈ 793.6px × 720 * 0.62 ≈
  // 446.4px). The native 1280x720 frame is positioned absolutely at
  // top-left inside the wrapper and transformed from that anchor, so
  // the visual fill matches the layout fill exactly — no clipping.
  // The wrapper is then centred inside .slide-top so we keep the
  // visual nice-ness of a centred slide when the aspect ratios
  // leave vertical headroom.
  //
  // Scale is min(a4Width/1280, a4TopHeight/720) — we use the smaller
  // of the two so the slide never overflows either axis. a4Width
  // is 210mm = ~794px at 96dpi, a4TopHeight is half of 297mm = ~561px.
  // min(794/1280, 561/720) = min(0.620, 0.779) = 0.620. We round to
  // 0.62 which is the same number as before — only the CSS mounting
  // changed.
  const A4_WIDTH_PX = 794;     // 210mm at 96dpi
  const A4_TOP_HEIGHT_PX = 561; // 297mm / 2 at 96dpi
  const SLIDE_NATIVE_W = 1280;
  const SLIDE_NATIVE_H = 720;
  const PDF_SCALE = Math.min(
    A4_WIDTH_PX / SLIDE_NATIVE_W,
    A4_TOP_HEIGHT_PX / SLIDE_NATIVE_H
  );
  const SCALED_W = SLIDE_NATIVE_W * PDF_SCALE;
  const SCALED_H = SLIDE_NATIVE_H * PDF_SCALE;

  const pages = slides
    .map((s) => {
      const boxes: Record<string, string> = {};
      for (const b of s.boxes) boxes[b.type] = b.content;
      const guion = stripBom(boxes[BoxType.SCRIPT] ?? "");
      const relevancia = stripBom(boxes[BoxType.RELEVANCE] ?? "");
      const narrativa = stripBom(boxes[BoxType.NARRATIVE] ?? "");
      const safeDesign = s.htmlDesign ? stripBom(s.htmlDesign) : "";

      const top = safeDesign
        ? `<div class="slide-scaler"><div class="slide-frame">${safeDesign}</div></div>`
        : `<div class="slide-empty">Sin diseño HTML generado</div>`;

      const bottom = `
        <div class="text-block">
          <h3>${escapeHtml(BOX_LABELS[BoxType.SCRIPT])}</h3>
          <p>${renderTextBlock(guion)}</p>
        </div>
        <div class="text-block">
          <h3>${escapeHtml(BOX_LABELS[BoxType.RELEVANCE])}</h3>
          <p>${renderTextBlock(relevancia)}</p>
        </div>
        <div class="text-block">
          <h3>${escapeHtml(BOX_LABELS[BoxType.NARRATIVE])}</h3>
          <p>${renderTextBlock(narrativa)}</p>
        </div>`;

      return `<section class="slide-page">${top}<div class="slide-bottom">${bottom}</div></section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(course.name)} — Slides PDF</title>
${KATEX_CDN_TAGS}
<style>
@page { size: A4 portrait; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; padding: 0; background: #fff; }
.slide-page {
  width: 210mm; height: 297mm;
  page-break-after: always;
  break-after: page;
  display: flex; flex-direction: column;
  overflow: hidden;
}
.slide-page:last-child { page-break-after: auto; break-after: auto; }

/* Top half -- slide design. flex-centres the scaled wrapper so the
   slide sits visually in the middle of the half-page when the
   aspect ratios leave vertical headroom. The wrapper is sized to
   the POST-scale footprint so the layout box matches the visual
   box; previously the 1280px layout box overflowed the 794px
   container and the flex centre clipped both sides.
   v1.8.1 / Issue 6 -- max-height: 50% belt-and-suspenders the
   height: 50% so the top half never grows beyond half the page
   even if the flex container expands unexpectedly (e.g. very long
   <section> content). overflow: hidden ensures any leakage
   is clipped instead of bleeding into the text section below. */
.slide-top {
  height: 50%;
  max-height: 50%;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: #fff;
  position: relative;
}
.slide-scaler {
  width: ${SCALED_W}px;
  height: ${SCALED_H}px;
  position: relative;
  overflow: hidden;
  flex: 0 0 auto;
}
.slide-frame {
  position: absolute;
  top: 0;
  left: 0;
  width: ${SLIDE_NATIVE_W}px;
  height: ${SLIDE_NATIVE_H}px;
  transform: scale(${PDF_SCALE});
  transform-origin: top left;
  background: #fff;
}
.slide-empty {
  color: #999; font-size: 14pt; font-style: italic;
}
.slide-bottom {
  height: 50%; padding: 10mm 15mm;
  font-family: system-ui, sans-serif; font-size: 11pt;
  overflow: hidden;
}
.slide-bottom h3 { font-size: 13pt; margin: 6pt 0 3pt; color: #1e293b; }
.slide-bottom p { font-size: 10pt; line-height: 1.4; margin: 0 0 4pt; color: #334155; }
.text-block { margin-bottom: 6pt; }
</style>
</head>
<body>${pages}</body>
</html>`;

  // Try Playwright first (web deployment). In the desktop build
  // Playwright is not bundled — we fall back to returning the HTML
  // so the Tauri WebView / browser can print to PDF natively (Ctrl+P).
  try {
    const pdfBuffer = await pdfRenderService.renderToPdf(html, {
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    const pdfBase64 = pdfBuffer.toString("base64");
    const filename = `${sanitizeFilename(course.name)}_slides.pdf`;
    return { pdf: pdfBase64, filename, pageCount: slides.length };
  } catch (err) {
    // Playwright not available (desktop build): return the HTML so the
    // client can open a print window. Any other render failure re-throws.
    if (err instanceof PlaywrightUnavailableError) {
      return {
        pdf: "",
        html,
        filename: `${sanitizeFilename(course.name)}_slides.html`,
        pageCount: slides.length,
      };
    }
    throw err;
  }
}

/**
 * Local escape helper. Kept private (not exported) because Next.js
 * requires every `export` from a `"use server"` file to be an async
 * function. Behaviour matches the helper of the same name in
 * `slide-export-helpers.ts`.
 */
function escapeHtml(input: string): string {
  if (!input) return "";
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render a text box's content for the PDF bottom-half. We strip
 * leftover HTML tags and markdown emphasis markers (LLM output is
 * messy), preserve newlines, and fall back to a muted "(vacío)"
 * placeholder so the printed page never shows a blank section.
 */
function renderTextBlock(input: string): string {
  if (!input) return '<span style="color:#999;font-style:italic">(vacío)</span>';
  const cleaned = input
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1");
  return escapeHtml(cleaned).replace(/\n/g, "<br/>");
}

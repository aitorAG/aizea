/**
 * Pure helpers used by the slide export server actions. These functions
 * are kept OUT of the `"use server"` file because Next.js requires
 * every `export` from a server-actions module to be an async function.
 *
 * Anything that touches the database, the filesystem, or Playwright
 * lives in `slide-export.ts`.
 */

import { BoxType } from "@/lib/types";

const BOX_LABELS: Record<string, string> = {
  [BoxType.SCRIPT]: "Guion",
  [BoxType.RELEVANCE]: "Relevancia",
  [BoxType.NARRATIVE]: "Narrativa",
  [BoxType.EXERCISE_1]: "Ejercicio 1",
  [BoxType.EXERCISE_2]: "Ejercicio 2",
};

export { BOX_LABELS };

export function sanitizeFilename(name: string): string {
  // Replace any chars that are unsafe in filenames with underscores.
  return (
    name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_\- ]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(0, 80) || "slide"
  );
}

/**
 * Strip a leading UTF-8 BOM (U+FEFF) and any other invisible unicode
 * noise from a string. LLMs occasionally prepend a BOM to their JSON
 * output, and some editors save UTF-8 files with a BOM. A leading BOM
 * inside a <script>, an HTML attribute, or even the start of a
 * document can break encoding detection in the browser, so we always
 * sanitize user-/LLM-provided text before it lands in a served file
 * or a rendered iframe.
 *
 * Idempotent: running on already-clean text is a no-op.
 */
export function stripBom(input: string): string {
  if (!input) return input;
  // U+FEFF is the canonical BOM. U+200B-U+200D and U+2060 are
  // zero-width chars that some editors paste; we strip them too.
  return input.replace(/^[\uFEFF\u200B-\u200D\u2060]+/, "");
}

/**
 * KaTeX CDN tags that we inject into any HTML document that hosts a
 * slide. The `auto-render` extension scans the body for `$..$` and
 * `$$..$$` (and `\(..\)`, `\[..\]`) delimiters and replaces them with
 * rendered math — exactly what the AI sometimes emits in `htmlDesign`
 * (e.g. `$E = mc^2$`, `$$\\int_0^1 x^2 dx$$`).
 *
 * Pinned to KaTeX 0.16.9 because the auto-render API has been stable
 * across this minor and we want reproducible builds. `defer` ensures
 * the scripts run after parsing, and we trigger rendering on
 * `DOMContentLoaded` so any `htmlDesign` injected by `doc.write` is
 * already in the DOM by the time the renderer walks it.
 */
export const KATEX_CDN_TAGS = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/contrib/auto-render.min.js"></script>
<script>
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof renderMathInElement === 'function') {
      renderMathInElement(document.body, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\\\(', right: '\\\\)', display: false },
          { left: '\\\\[', right: '\\\\]', display: true }
        ],
        throwOnError: false
      });
    }
  });
</script>`;

/**
 * Build a complete, standalone HTML document around the slide's
 * `htmlDesign`. The slide HTML is assumed to be a 1280x720 design, so
 * we wrap it in a fixed-size container and use `transform: scale()`
 * to fit the viewport width (this is the same trick the detail page
 * uses for its inline preview, so the visual fidelity is identical).
 *
 * Encoding contract:
 *   - The document is emitted as UTF-8 (the only sensible default
 *     for HTML5 and the only encoding the user-facing JS layer
 *     assumes).
 *   - `<meta charset="utf-8">` is the FIRST child of `<head>` so the
 *     browser can detect the encoding from the first 1024 bytes even
 *     if the parent document is in a different encoding.
 *   - Any leading BOM in the upstream `htmlDesign` is stripped
 *     (LLM-generated HTML occasionally contains one).
 *
 * KaTeX is included so that LaTeX formulas in `htmlDesign` (the AI
 * often emits things like `$E = mc^2$` or `$$\\int_0^1 x^2 dx$$`)
 * render properly when the user opens the downloaded file in a
 * browser. This matches the behaviour of the in-page preview.
 */
export function buildStandaloneSlideHtml(params: {
  title: string;
  htmlDesign: string;
}): string {
  const { title, htmlDesign } = params;
  const safeTitle = escapeHtml(stripBom(title));
  const safeDesign = stripBom(htmlDesign);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${safeTitle}</title>
<meta name="viewport" content="width=1280, initial-scale=1" />
${KATEX_CDN_TAGS}
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    min-height: 100vh;
  }
  .slide-frame {
    position: relative;
    width: 1280px;
    height: 720px;
    transform-origin: top left;
    overflow: hidden;
    background: #ffffff;
  }
  @media (max-width: 1280px) {
    .slide-frame { transform: scale(calc(100vw / 1280)); }
  }
</style>
</head>
<body>
  <div class="slide-frame">${safeDesign}</div>
</body>
</html>`;
}

/**
 * Wrap a slide's `htmlDesign` in the minimum HTML document needed to
 * render it inside an iframe (`srcdoc` or `doc.write`).
 *
 * Used by the slide detail preview so the iframe inherits the SAME
 * UTF-8 contract as the standalone export — this is the single
 * source of truth for "what HTML does a slide render in". The
 * container CSS matches the export's `.slide-frame` so visual
 * fidelity between preview and downloaded file is identical.
 *
 * KaTeX is also loaded so LaTeX formulas in `htmlDesign` (e.g.
 * `$x^2$`, `$$\\sum_{i=1}^n i$$`) render in the preview exactly as
 * they will in the downloaded file. The parent component is
 * responsible for scaling the iframe to fit its container — we only
 * need to ensure the document is well-formed and the math renders.
 */
export function buildIframeSlideHtml(params: {
  htmlDesign: string;
}): string {
  const safeDesign = stripBom(params.htmlDesign);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1280, initial-scale=1" />
${KATEX_CDN_TAGS}
<style>
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body {
    display: flex;
    align-items: flex-start;
    justify-content: center;
    min-height: 100vh;
  }
  .slide-frame {
    position: relative;
    width: 1280px;
    height: 720px;
    transform-origin: top left;
    overflow: hidden;
    background: #ffffff;
  }
</style>
</head>
<body>
  <div class="slide-frame">${safeDesign}</div>
</body>
</html>`;
}

/**
 * Build a multi-page A4 HTML document, one slide per page. The slide
 * HTML is auto-scaled to the printable A4 width minus margins.
 */
export function buildPdfHtml(params: {
  courseName: string;
  slides: Array<{
    title: string;
    description: string;
    htmlDesign: string | null;
    boxes: Record<string, string>;
  }>;
}): string {
  const { courseName, slides } = params;
  const pages = slides
    .map((s, i) => {
      const guion = s.boxes[BoxType.SCRIPT] ?? "";
      const relevancia = s.boxes[BoxType.RELEVANCE] ?? "";
      const narrativa = s.boxes[BoxType.NARRATIVE] ?? "";
      // Strip BOM from every LLM-derived string — the PDF generator
      // embeds these in a Chromium page, and a leading BOM inside
      // a <section> would render as the U+FEFF "unknown" glyph.
      const safeTitle = stripBom(s.title);
      const safeDescription = stripBom(s.description);
      const safeCourseName = stripBom(courseName);
      const safeGuion = stripBom(guion);
      const safeRelevancia = stripBom(relevancia);
      const safeNarrativa = stripBom(narrativa);
      const safeDesign = s.htmlDesign ? stripBom(s.htmlDesign) : null;
      return `
<section class="page">
  <header class="page-header">
    <span class="page-header__num">${i + 1} / ${slides.length}</span>
    <span class="page-header__course">${escapeHtml(safeCourseName)}</span>
  </header>

  <div class="slide-area">
    ${
      safeDesign
        ? `<div class="slide-scaler"><div class="slide-frame">${safeDesign}</div></div>`
        : `<div class="slide-empty">Sin diseño HTML generado</div>`
    }
  </div>

  <div class="text-area">
    <h2 class="slide-title">${escapeHtml(safeTitle)}</h2>
    ${safeDescription ? `<p class="slide-desc">${escapeHtml(safeDescription)}</p>` : ""}
    <div class="text-block"><h3>${BOX_LABELS[BoxType.SCRIPT]}</h3><div>${renderText(safeGuion)}</div></div>
    <div class="text-block"><h3>${BOX_LABELS[BoxType.RELEVANCE]}</h3><div>${renderText(safeRelevancia)}</div></div>
    <div class="text-block"><h3>${BOX_LABELS[BoxType.NARRATIVE]}</h3><div>${renderText(safeNarrativa)}</div></div>
  </div>
</section>`;
    })
    .join("\n");

  // v1.8 / Issue 4.1 — compute the scale and scaled wrapper size
  // OUTSIDE the CSS template so the layout box matches the visual
  // box. Previous version centred a 1280x720 element with
  // `transform: scale(0.53)` and `align-items: center; justify-content:
  // center` — the layout box was still 1280px wide, so flex centred
  // the layout centre in the ~703px printable area, clipping ~289px
  // off the LEFT and ~289px off the RIGHT of every slide. The user
  // only ever saw the middle 43% of the slide.
  //
  // The fix mirrors the one in slide-export.ts (`exportAllSlidesPdfAction`):
  // a `.slide-scaler` wrapper sized to the post-scale footprint
  // (1280 * 0.55 ≈ 703.4px × 720 * 0.55 ≈ 395.4px) wraps a
  // position:absolute 1280x720 frame transformed from top-left. Layout
  // box = visual box, no clipping.
  //
  // The previous scale (0.53) was the result of `min(703/1280, 509/720)`
  // = min(0.549, 0.707) = 0.549, rounded down to 0.53. The new scale
  // is computed from the same numbers but rounded more accurately
  // (0.55) — the visual difference is small but the layout math is
  // now correct.
  const PRINTABLE_WIDTH_PX = 703;   // 186mm at 96dpi
  const PRINTABLE_TOP_HEIGHT_PX = 509; // 135.5mm at 96dpi
  const SLIDE_NATIVE_W = 1280;
  const SLIDE_NATIVE_H = 720;
  const PDF_SCALE = Math.min(
    PRINTABLE_WIDTH_PX / SLIDE_NATIVE_W,
    PRINTABLE_TOP_HEIGHT_PX / SLIDE_NATIVE_H
  );
  const SCALED_W = SLIDE_NATIVE_W * PDF_SCALE;
  const SCALED_H = SLIDE_NATIVE_H * PDF_SCALE;

  // v1.9 / Issue 6 — inject KaTeX CDN tags into the PDF HTML so the
  // AI-generated `htmlDesign` (which often contains `$..$` and `$$..$$`
  // delimiters) renders properly. We rely on the `KATEX_CDN_TAGS`
  // constant defined at the top of this file so the CDN version stays
  // pinned in one place. The renderer is triggered on
  // `DOMContentLoaded` and walks the body — the PDF generation in
  // slide-export.ts must wait for `.katex` elements to appear before
  // calling `page.pdf()`, otherwise the formula glyphs would be
  // captured as raw text.
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(courseName)} — Export PDF</title>
${KATEX_CDN_TAGS}
<style>
  @page {
    size: A4 portrait;
    margin: 12mm 12mm 14mm 12mm;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111;
    background: #fff;
  }

  .page {
    page-break-after: always;
    break-after: page;
    display: flex;
    flex-direction: column;
    /* Printable A4 portrait area: 210mm - 24mm horizontal = 186mm wide.
       We use 50% for the slide, 50% for the text — exactly as requested. */
    height: 269mm; /* 297mm - 12mm top - 14mm bottom = ~271mm; we leave 2mm slack */
  }
  .page:last-child { page-break-after: auto; break-after: auto; }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 9pt;
    color: #666;
    border-bottom: 1px solid #ddd;
    padding-bottom: 4px;
    margin-bottom: 6px;
  }
  .page-header__num { font-weight: 600; }
  .page-header__course { font-style: italic; }

  .slide-area {
    height: 50%;
    min-height: 50%;
    border: 1px solid #e5e5e5;
    background: #fafafa;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  /* The slide design is rendered at 1280x720 (16:9). The printable A4
     width is ~186mm (210mm page - 12mm L/R margins), which equals
     ~703px at 96dpi. We use a SCALED WRAPPER (.slide-scaler) sized
     to the post-scale footprint, then position the native frame
     absolutely inside it from top-left. The previous version did
     'transform: scale(0.53)' on a 1280x720 element with flex-centring;
     the layout box was still 1280px so flex centred the layout
     centre, clipping both sides of the slide. Now the layout box
     matches the visual box — no clipping. */
  .slide-scaler {
    width: ${SCALED_W}px;
    height: ${SCALED_H}px;
    position: relative;
    overflow: hidden;
    flex: 0 0 auto;
    background: #fff;
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
    color: #999;
    font-size: 10pt;
    font-style: italic;
  }

  .text-area {
    margin-top: 6px;
    height: 50%;
    min-height: 50%;
    overflow: hidden;
    font-size: 9pt;
    line-height: 1.35;
  }
  .slide-title {
    font-size: 12pt;
    font-weight: 700;
    margin: 0 0 2px 0;
  }
  .slide-desc {
    font-size: 9pt;
    color: #444;
    margin: 0 0 6px 0;
  }
  .text-block { margin-bottom: 4px; }
  .text-block h3 {
    font-size: 9pt;
    font-weight: 700;
    margin: 0 0 1px 0;
    color: #333;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .text-block div {
    white-space: pre-wrap;
    word-wrap: break-word;
  }
</style>
</head>
<body>
${pages}
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Plain-text rendering of the box content. We keep newlines and strip
 * any leftover markdown markers but DO NOT add HTML chrome that would
 * break the PDF layout — the PDF is meant to be a faithful, printable
 * snapshot, not an interactive reading experience.
 */
function renderText(input: string): string {
  if (!input) return '<span style="color:#999;font-style:italic">(vacío)</span>';
  // Strip bold/italic markers and stray HTML tags that some legacy boxes have.
  const cleaned = input
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1");
  return escapeHtml(cleaned);
}

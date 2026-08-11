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
/** Minimal HTML-escape for text interpolated into export templates. */
function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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
<meta name="viewport" content="width=1123, initial-scale=1" />
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
    width: 1123px;
    height: 794px;
    transform-origin: top left;
    overflow: hidden;
    background: #ffffff;
  }
  @media (max-width: 1123px) {
    .slide-frame { transform: scale(calc(100vw / 1123)); }
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
<meta name="viewport" content="width=1123, initial-scale=1" />
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
    width: 1123px;
    height: 794px;
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

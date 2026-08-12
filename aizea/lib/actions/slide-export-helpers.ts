/**
 * Pure helpers used by the slide export server actions. These functions
 * are kept OUT of the `"use server"` file because Next.js requires
 * every `export` from a server-actions module to be an async function.
 *
 * Anything that touches the database, the filesystem, or Playwright
 * lives in `slide-export.ts`.
 */

import { BoxType } from "@/lib/types";
import {
  KATEX_INLINE_CSS,
  KATEX_INLINE_JS,
} from "@/lib/domain/slides/katex-inline.generated";

/** Native slide authoring size: A4 landscape @96dpi. */
export const SLIDE_W = 1123;
export const SLIDE_H = 794;

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
 * KaTeX inlined (CSS with base64 woff2 fonts + JS) for 100% OFFLINE rendering.
 * Replaces the old CDN `<link>`/`<script>` tags: the desktop `.exe` has no
 * internet guarantee, and `srcdoc` / `file://` / Playwright `setContent` don't
 * resolve relative asset paths reliably — inlining is the only approach that
 * renders identically in all three surfaces with zero network.
 */
export const KATEX_INLINE_HEAD = `<style>${KATEX_INLINE_CSS}</style>
<script>${KATEX_INLINE_JS}</script>`;

/**
 * Deterministic auto-fit + KaTeX render script, shared by ALL slide surfaces
 * (preview iframe, standalone HTML, Playwright PDF). Emitted inline so every
 * surface runs the IDENTICAL code:
 *
 *   1. Render LaTeX (`renderMathInElement`) inside `.slide-content`.
 *   2. Wait for fonts (`document.fonts.ready`) so KaTeX metrics are final.
 *   3. Measure the natural `scrollWidth/Height` of the content (with its fixed
 *      box neutralised by CSS) and apply ONE `transform: scale(min(1, …))` so
 *      it always fits 1123×794 with zero clipping and zero scrollbars.
 *   4. Set `window.__slideFitDone = true` — Playwright waits on this flag
 *      before `page.pdf()`.
 *
 * Delimiters: `$$`/`\[..\]` (display) are matched BEFORE `$`/`\(..\)` (inline)
 * so display math wins greedily; `$` is kept as a legacy safety net (the prompt
 * now prefers `\(..\)`/`\[..\]`). `strict:false`, `throwOnError:false` and
 * `ignoredTags` keep it resilient.
 */
export const SLIDE_FIT_SCRIPT = `<script>
(function () {
  var OPTS = {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\\\[", right: "\\\\]", display: true },
      { left: "\\\\(", right: "\\\\)", display: false },
      { left: "$", right: "$", display: false }
    ],
    throwOnError: false, strict: false,
    ignoredTags: ["script","noscript","style","textarea","pre","code"]
  };
  function fitOne(f) {
    var c = f.querySelector(".slide-content");
    if (!c) return;
    f.style.transform = "none";
    // Measure the natural content size. The design root is forced to height:auto
    // (see CSS) so scrollHeight/Width reflect the TRUE content extent even when
    // the design authored a fixed 794px box or used flex centering.
    var w = c.scrollWidth, h = c.scrollHeight;
    var s = Math.min(1, ${SLIDE_W} / w, ${SLIDE_H} / h);
    var tx = (${SLIDE_W} - w * s) / 2;
    f.style.transform = "translateX(" + (tx > 0 ? tx : 0) + "px) scale(" + s + ")";
  }
  function fit() {
    // Fit EVERY frame (1 in the preview/standalone; N in the multi-slide PDF).
    var fits = document.querySelectorAll(".slide-fit");
    for (var i = 0; i < fits.length; i++) fitOne(fits[i]);
    window.__slideFitDone = true;
  }
  // Wait for EVERY image to finish decoding before measuring. Figure slides
  // embed base64 <img> (data URIs); without this the fit would measure them at
  // height 0 and mis-scale / clip. Resolves on load AND error (a broken image
  // must not wedge the fit) with a hard per-image cap.
  function waitForImages(root) {
    var imgs = Array.prototype.slice.call(root.querySelectorAll("img"));
    var pending = imgs.filter(function (im) { return !im.complete || im.naturalWidth === 0; });
    if (pending.length === 0) return Promise.resolve();
    return Promise.all(pending.map(function (im) {
      return new Promise(function (resolve) {
        var done = false;
        var finish = function () { if (!done) { done = true; resolve(); } };
        im.addEventListener("load", finish, { once: true });
        im.addEventListener("error", finish, { once: true });
        if (im.decode) { im.decode().then(finish).catch(finish); }
        setTimeout(finish, 4000);
      });
    }));
  }
  function run() {
    // Render math in every content block (auto-render walks descendants).
    var blocks = document.querySelectorAll(".slide-content");
    try {
      if (window.renderMathInElement) {
        for (var i = 0; i < blocks.length; i++) renderMathInElement(blocks[i], OPTS);
      }
    } catch (e) {}
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready : Promise.resolve();
    // Both fonts AND images must settle before measuring, else the layout is
    // still shifting when we compute the scale.
    Promise.all([fontsReady, waitForImages(document)]).then(function () {
      requestAnimationFrame(function () { requestAnimationFrame(fit); });
    }).catch(function () { window.__slideFitDone = true; });
  }
  if (document.readyState !== "loading") run();
  else document.addEventListener("DOMContentLoaded", run);
})();
</script>`;

/**
 * Shared CSS for the slide frame across all surfaces. The structure is:
 *   `.slide-frame` (fixed 1123×794, overflow:hidden — the printable box)
 *     └ `.slide-fit` (the transform target — auto-fit scales THIS)
 *         └ `.slide-content` (the LLM `htmlDesign`)
 *
 * The design's own root div is authored as a fixed 1123×794 `overflow:hidden`
 * box — that is the REAL clip source, so we neutralise its height/overflow (and
 * any inner scroll container) so the true content height is measurable and the
 * painted box isn't pre-clipped before scaling. Width stays 1123px for
 * deterministic line breaks.
 */
export const SLIDE_FRAME_CSS = `
  html, body { margin: 0; padding: 0; background: #ffffff; overflow: hidden; }
  .slide-frame {
    position: relative;
    width: ${SLIDE_W}px;
    height: ${SLIDE_H}px;
    overflow: hidden;
    background: #ffffff;
  }
  .slide-fit { transform-origin: top left; width: ${SLIDE_W}px; }
  /* Neutralise the design's own fixed box + any inner scroll containers so the
     content can be measured at natural height and never clips after scaling.
     The design root is forced to height:auto (grows with content, so
     scrollHeight is EXACT even if it authored height:794px or used flex
     centering) while min-height keeps short content filling the frame. */
  .slide-content > * {
    height: auto !important;
    max-height: none !important;
    min-height: ${SLIDE_H}px;
  }
  .slide-content, .slide-content * { overflow: visible !important; }
`;

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

/**
 * THE single source of truth for "what HTML does a slide render in".
 *
 * Builds a complete, standalone, OFFLINE HTML document around a slide's
 * `htmlDesign`, used identically by the preview iframe, the standalone HTML
 * export, and the Playwright PDF path. Every surface therefore runs the SAME
 * inline KaTeX and the SAME deterministic auto-fit script (`SLIDE_FIT_SCRIPT`),
 * guaranteeing byte-identical rendering.
 *
 * Structure: `.slide-frame` (fixed 1123×794, overflow:hidden) → `.slide-fit`
 * (transform target) → `.slide-content` (the LLM design). The fit script
 * measures the natural content size after KaTeX + fonts and applies one
 * `transform: scale()` so content ALWAYS fits with zero clipping/scroll, then
 * sets `window.__slideFitDone`.
 *
 * Encoding: UTF-8, `<meta charset>` first; any leading BOM in `htmlDesign` is
 * stripped (LLM output occasionally contains one).
 */
export function buildSlideDocument(params: {
  htmlDesign: string;
  title?: string;
}): string {
  const safeDesign = stripBom(params.htmlDesign);
  const titleTag =
    params.title != null
      ? `<title>${escapeHtml(stripBom(params.title))}</title>`
      : "";
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
${titleTag}
<meta name="viewport" content="width=${SLIDE_W}, initial-scale=1" />
${KATEX_INLINE_HEAD}
<style>${SLIDE_FRAME_CSS}</style>
</head>
<body>
  <div class="slide-frame"><div class="slide-fit"><div class="slide-content">${safeDesign}</div></div></div>
${SLIDE_FIT_SCRIPT}
</body>
</html>`;
}

/**
 * Standalone slide HTML for the "Exportar HTML" download. Thin wrapper over
 * {@link buildSlideDocument} (kept for a stable, named export the actions use).
 */
export function buildStandaloneSlideHtml(params: {
  title: string;
  htmlDesign: string;
}): string {
  return buildSlideDocument({
    htmlDesign: params.htmlDesign,
    title: params.title,
  });
}

/**
 * Slide HTML for the detail-page preview iframe (`srcdoc`). Thin wrapper over
 * {@link buildSlideDocument} so preview and export are byte-identical.
 */
export function buildIframeSlideHtml(params: { htmlDesign: string }): string {
  return buildSlideDocument({ htmlDesign: params.htmlDesign });
}

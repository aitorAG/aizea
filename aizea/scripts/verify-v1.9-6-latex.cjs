/**
 * v1.9 / Issue 6 — PDF LaTeX render verification.
 *
 * Builds the same PDF HTML that `exportAllSlidesPdfAction` produces
 * for a slide whose `htmlDesign` contains LaTeX formulas, renders
 * it with Playwright (mirroring the action's flow), and asserts
 * that:
 *   1. KaTeX was loaded and auto-render ran (>= 1 `.katex` element).
 *   2. The raw `$..$` / `$$..$$` source is GONE from the visible
 *      text (proves the render replaced the delimiters, not just
 *      added a `.katex` node alongside them).
 *   3. The PDF was actually produced and has the expected page
 *      count.
 *
 * The action under test is `exportAllSlidesPdfAction` in
 * `lib/actions/slide-export.ts`. We can't easily call a server
 * action from a plain Node script (it needs Next.js request
 * context), so we exercise the SAME HTML template + Playwright
 * pipeline that the action uses. The fix lives in the HTML
 * template (KATEX_CDN_TAGS injection) and in `waitForKatexRender`
 * which polls for `.katex` elements; both are tested here.
 *
 * Output:
 *   .test-artifacts/evidence/v1.9/6-latex.png        — screenshot of rendered slide
 *   .test-artifacts/evidence/v1.9/6-latex.pdf        — captured PDF
 *   .test-artifacts/evidence/v1.9/6-latex.json       — pass/fail summary
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const EVIDENCE = path.resolve(__dirname, "..", ".test-artifacts", "evidence", "v1.9");
fs.mkdirSync(EVIDENCE, { recursive: true });

const SCREENSHOT_LATEX = path.join(EVIDENCE, "6-latex.png");
const PDF_LATEX = path.join(EVIDENCE, "6-latex.pdf");
const VERIFICATION = path.join(EVIDENCE, "6-latex.json");

// A 1280x720 slide fragment that contains several LaTeX formulas —
// exactly the shape the AI tends to emit in `htmlDesign`. Includes
// inline (`$..$`), display (`$$..$$`), and `\frac` to exercise the
// auto-render pipeline.
const FORMULA_HTML = `<div style="width:1280px;height:720px;padding:48px;box-sizing:border-box;background:linear-gradient(135deg,#eef2ff,#e0e7ff);font-family:system-ui,sans-serif;color:#1e293b;">
  <h1 style="font-size:42px;margin:0 0 24px 0;">Fórmulas LaTeX en el PDF</h1>
  <div style="font-size:22px;line-height:1.6;max-width:1100px;">
    <p>La energía relativista: $E = mc^2$.</p>
    <p>El teorema de Pitágoras: $$a^2 + b^2 = c^2.$$</p>
    <p>La suma de los primeros $n$ naturales: $$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}.$$</p>
    <p>Una integral definida: $$\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}.$$</p>
    <p>Fracción mixta en línea: $\\frac{\\partial f}{\\partial x}$.</p>
  </div>
</div>`;

const BOX_LABELS = { SCRIPT: "Guion", RELEVANCE: "Relevancia", NARRATIVE: "Narrativa" };

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripBom(s) {
  return (s ?? "").replace(/^[\uFEFF\u200B-\u200D\u2060]+/, "");
}

function renderTextBlock(s) {
  if (!s) return '<span style="color:#999;font-style:italic">(vacío)</span>';
  const cleaned = s
    .replace(/<\/?[^>]+>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1");
  return escapeHtml(cleaned).replace(/\n/g, "<br/>");
}

// The EXACT same template the production action uses. Mirrored here
// (rather than imported) because the action lives behind `"use server"`
// which makes direct require() unsafe. The fix is the
// `${KATEX_CDN_TAGS}` injection inside <head>.
const KATEX_CDN_TAGS = `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
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

const A4_WIDTH_PX = 794;
const A4_TOP_HEIGHT_PX = 561;
const SLIDE_NATIVE_W = 1280;
const SLIDE_NATIVE_H = 720;
const PDF_SCALE = Math.min(A4_WIDTH_PX / SLIDE_NATIVE_W, A4_TOP_HEIGHT_PX / SLIDE_NATIVE_H);
const SCALED_W = SLIDE_NATIVE_W * PDF_SCALE;
const SCALED_H = SLIDE_NATIVE_H * PDF_SCALE;

function buildHtml() {
  const safeDesign = stripBom(FORMULA_HTML);
  const top = `<div class="slide-scaler"><div class="slide-frame">${safeDesign}</div></div>`;
  const bottom = `
    <div class="text-block">
      <h3>${escapeHtml(BOX_LABELS.SCRIPT)}</h3>
      <p>${renderTextBlock("Saludo y objetivos.")}</p>
    </div>
    <div class="text-block">
      <h3>${escapeHtml(BOX_LABELS.RELEVANCE)}</h3>
      <p>${renderTextBlock("Aplicación práctica.")}</p>
    </div>
    <div class="text-block">
      <h3>${escapeHtml(BOX_LABELS.NARRATIVE)}</h3>
      <p>${renderTextBlock("Una historia corta.")}</p>
    </div>`;
  const page = `<section class="slide-page">${top}<div class="slide-bottom">${bottom}</div></section>`;
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>v1.9 Issue 6 — LaTeX PDF</title>
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
<body>${page}</body>
</html>`;
}

async function waitForKatexRender(page, maxMs = 8000) {
  return page.evaluate((maxMsArg) => {
    return new Promise((resolve) => {
      const start = Date.now();
      const body = document.body?.innerHTML ?? "";
      const hadLatex = /\$[^$]+\$|\\\(|\\\[/.test(body);
      if (!hadLatex) {
        setTimeout(() => resolve({ rendered: -1, hadLatex: false }), Math.min(200, maxMsArg));
        return;
      }
      const tick = () => {
        const rendered = document.querySelectorAll(".katex").length;
        if (rendered > 0) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve({ rendered, hadLatex: true }));
          });
          return;
        }
        if (Date.now() - start >= maxMsArg) {
          resolve({ rendered: 0, hadLatex: true });
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }, maxMs);
}

async function main() {
  const result = {
    startedAt: new Date().toISOString(),
    steps: [],
    passes: 0,
    failures: 0,
  };

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
    });

    const html = buildHtml();
    await page.setContent(html, { waitUntil: "networkidle", timeout: 30000 });
    result.steps.push({ step: "set-content", ok: true });

    // IMPORTANT: KaTeX auto-render is synchronous-ish — by the time
    // `networkidle` resolves the renderer has often already run and
    // replaced the raw `$..$` source. So checking innerHTML for
    // raw delimiters gives a false negative. We instead poll for
    // `.katex` elements (which only exist if the renderer produced
    // them) and then assert the rendered math glyphs are present.
    const katex = await waitForKatexRender(page);
    result.steps.push({ step: "wait-katex", ...katex, ok: true });

    // The wait helper resolves with `rendered: -1` when it
    // couldn't detect LaTeX in the body — but that detection runs
    // on innerHTML AFTER setContent, which may already be empty
    // because KaTeX ran. Re-check directly via DOM.
    const katexCount = await page.evaluate(
      () => document.querySelectorAll(".katex").length
    );
    const katexOk = katexCount >= 5; // 5 formulas in our sample
    result.steps.push({
      step: "katex-count",
      renderedCount: katexCount,
      expected: ">= 5",
      ok: katexOk,
    });
    if (katexOk) result.passes++;
    else result.failures++;

    // Assert: NO raw `$..$` source visible in the text. If the
    // renderer failed silently we'd see literal `$E = mc^2$` in
    // innerText.
    const text = await page.evaluate(() => document.body.innerText);
    const rawPatterns = [
      /\$E\s*=\s*mc\^2\$/,
      /\$\$a\^2\s*\+\s*b\^2\s*=\s*c\^2\$\$/,
      /\$n\$/,
    ];
    const rawHits = rawPatterns.map((re) => ({ pattern: re.source, hit: re.test(text) }));
    const noRaw = rawHits.every((h) => !h.hit);
    result.steps.push({ step: "no-raw-source", rawHits, sample: text.slice(0, 600), ok: noRaw });
    if (noRaw) result.passes++;
    else result.failures++;

    // Capture the rendered slide. We screenshot the slide-scaler
    // so the evidence shows the FORMULAS, not the page chrome.
    const slideScaler = page.locator(".slide-scaler").first();
    await slideScaler.screenshot({ path: SCREENSHOT_LATEX });
    result.steps.push({
      step: "screenshot-slide",
      path: path.relative(EVIDENCE, SCREENSHOT_LATEX),
      ok: true,
    });

    // Now also generate the PDF to confirm the same HTML produces
    // a valid PDF with the rendered math.
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    fs.writeFileSync(PDF_LATEX, pdfBuffer);
    const head = pdfBuffer.subarray(0, 5).toString("ascii");
    const body = pdfBuffer.toString("binary");
    const pageMatches = body.match(/\/Type\s*\/Page(?!s)/g) ?? [];
    const pdfHeaderOk = head === "%PDF-";
    const pdfPageOk = pageMatches.length === 1;
    result.steps.push({
      step: "pdf",
      header: head,
      pageCount: pageMatches.length,
      bytes: pdfBuffer.length,
      path: path.relative(EVIDENCE, PDF_LATEX),
      ok: pdfHeaderOk && pdfPageOk,
    });
    if (pdfHeaderOk) result.passes++;
    else result.failures++;
    if (pdfPageOk) result.passes++;
    else result.failures++;
  } catch (e) {
    result.steps.push({ step: "exception", message: e.message, ok: false });
    result.failures++;
  } finally {
    await browser.close();
  }

  result.finishedAt = new Date().toISOString();
  result.allPassed = result.failures === 0;
  fs.writeFileSync(VERIFICATION, JSON.stringify(result, null, 2));
  console.log("\n=== v1.9 Issue 6 LaTeX PDF verification ===");
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPassed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

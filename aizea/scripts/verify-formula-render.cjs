// F1.4 (v1.5 plan) — verify that the slide preview iframe renders
// LaTeX formulas. We pick an existing slide with `htmlDesign`,
// temporarily replace its HTML with a slide that contains several
// LaTeX expressions, open the slide detail page, wait for the
// iframe to load KaTeX from the CDN, and screenshot the result.
//
//   node scripts/verify-formula-render.cjs
//
// Outputs:
//   .test-artifacts/evidence/v1.5/wave-1/1.4-formulas.png    — full page
//   .test-artifacts/evidence/v1.5/wave-1/1.4-preview.png     — tight crop on iframe
//   .test-artifacts/evidence/v1.5/wave-1/1.4-verification.json — pass/fail summary
//
// The original `htmlDesign` is restored on the way out (or the test
// slide is deleted if we created one from scratch) so this script is
// idempotent and safe to re-run.

const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const EVIDENCE = path.resolve(__dirname, "..", ".test-artifacts", "evidence", "v1.5", "wave-1");
fs.mkdirSync(EVIDENCE, { recursive: true });

const SCREENSHOT_FULL = path.join(EVIDENCE, "1.4-formulas.png");
const SCREENSHOT_PREVIEW = path.join(EVIDENCE, "1.4-preview.png");
const SCREENSHOT_MODAL = path.join(EVIDENCE, "1.4-formula-modal.png");
const VERIFICATION = path.join(EVIDENCE, "1.4-verification.json");
const FORMULA_SAMPLE_PATH = path.join(EVIDENCE, "1.4-sample.html");

const BASE = "http://localhost:3000";

// Build a 1280x720 slide fragment with a few LaTeX formulas of the
// shape the AI tends to emit: inline `$..$`, display `$$..$$`, and
// some characters that exercise the auto-render pipe.
const FORMULA_HTML = `<div style="width:1280px;height:720px;padding:48px;box-sizing:border-box;background:linear-gradient(135deg,#eef2ff,#e0e7ff);font-family:system-ui,sans-serif;color:#1e293b;">
  <h1 style="font-size:42px;margin:0 0 24px 0;">Fórmulas LaTeX en la vista previa</h1>
  <div style="font-size:22px;line-height:1.6;max-width:1100px;">
    <p>La energía relativista: $E = mc^2$.</p>
    <p>El teorema de Pitágoras: $$a^2 + b^2 = c^2.$$</p>
    <p>La suma de los primeros $n$ naturales: $$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}.$$</p>
    <p>Una integral definida: $$\\int_{0}^{1} x^2 \\, dx = \\frac{1}{3}.$$</p>
    <p>Fracción mixta en línea: $\\frac{\\partial f}{\\partial x}$.</p>
  </div>
</div>`;

async function main() {
  const result = {
    startedAt: new Date().toISOString(),
    steps: [],
    passes: 0,
    failures: 0,
  };

  const db = new PrismaClient();
  let slide = null;
  let originalHtml = null;
  let createdTempSlide = false;

  // Use a Prisma transaction-ish flow: pick an existing slide, save
  // its htmlDesign, swap in the formula-rich version.
  try {
    slide = await db.slide.findFirst({
      where: { htmlDesign: { not: null } },
      orderBy: { updatedAt: "desc" },
      include: { course: { select: { id: true, name: true } } },
    });
    if (!slide) {
      throw new Error(
        "No slide with htmlDesign found — run the pipeline first so at least one slide has generated HTML."
      );
    }
    originalHtml = slide.htmlDesign;
    result.steps.push({
      step: "pick-slide",
      slideId: slide.id,
      slideTitle: slide.title,
      courseId: slide.courseId,
      courseName: slide.course.name,
      ok: true,
    });

    await db.slide.update({
      where: { id: slide.id },
      data: { htmlDesign: FORMULA_HTML },
    });
    result.steps.push({ step: "inject-formula-html", ok: true });
  } catch (e) {
    result.steps.push({ step: "setup", message: e.message, ok: false });
    result.failures++;
    await db.$disconnect();
    fs.writeFileSync(VERIFICATION, JSON.stringify(result, null, 2));
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  // Persist the wrapped HTML we expect the preview to render so the
  // reviewer can open it in a browser if the iframe screenshot is
  // ambiguous.
  try {
    const sample = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>F1.4 sample — LaTeX render</title>
<meta name="viewport" content="width=1280, initial-scale=1" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
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
</script>
</head>
<body>${FORMULA_HTML}</body>
</html>`;
    fs.writeFileSync(FORMULA_SAMPLE_PATH, sample);
    result.steps.push({
      step: "write-sample",
      path: path.relative(EVIDENCE, FORMULA_SAMPLE_PATH),
      bytes: sample.length,
      ok: true,
    });
  } catch (e) {
    result.steps.push({ step: "write-sample", message: e.message, ok: false });
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 1000 },
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        // KaTeX warns about unsupported commands via console.error;
        // those are noise, log them but don't fail the test.
        console.log("CONSOLE ERROR:", msg.text());
      }
    });

    // 1. Open the slide detail page. The server component reads
    // htmlDesign from the DB so it picks up the formula-rich
    // version we just wrote.
    const url = `${BASE}/courses/${slide.courseId}/slides/${slide.id}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    result.steps.push({ step: "navigate", url, ok: true });

    // 2. Wait for the preview iframe to appear and for its content
    // document to fully load (KaTeX scripts are defer + DOMContentLoaded,
    // so we need a beat for them to run).
    const iframe = page.locator('iframe[title="Vista previa de la diapositiva"]').first();
    await iframe.waitFor({ state: "visible", timeout: 15000 });
    const iframeEl = await iframe.elementHandle();
    const frame = await iframeEl.contentFrame();
    if (!frame) throw new Error("Could not get iframe content frame");
    await frame.waitForLoadState("domcontentloaded", { timeout: 15000 });
    // KaTeX loads from CDN with defer, so give it a generous timeout
    // for both the script fetch and the auto-render pass.
    await frame.waitForFunction(
      () => {
        // The page is "ready" when the auto-render extension has
        // produced at least one `.katex` element (i.e. some math
        // was found and rendered) — or, failing that, when the
        // library is at least available.
        const hasKatex = document.querySelector(".katex");
        const hasLib = typeof window.renderMathInElement === "function";
        return Boolean(hasKatex) || hasLib;
      },
      { timeout: 30000 }
    );
    // Small extra delay so the .katex nodes are fully painted.
    await page.waitForTimeout(800);
    result.steps.push({ step: "wait-katex", ok: true });

    // 3. Count rendered KaTeX elements inside the iframe. A correct
    // render produces a `.katex` block per formula. We expect at
    // least 5 (3 inline + 2 display in our sample).
    const katexCount = await frame.evaluate(
      () => document.querySelectorAll(".katex").length
    );
    const katexOk = katexCount >= 5;
    result.steps.push({
      step: "katex-count",
      renderedCount: katexCount,
      expected: ">= 5",
      ok: katexOk,
    });
    if (katexOk) result.passes++;
    else result.failures++;

    // 4. Also assert that the raw `$..$` source is GONE — if the
    // formula was not rendered, the literal text "E = mc^2" wrapped
    // in dollar signs would still be visible.
    const rawText = await frame.evaluate(() => {
      const body = document.body.innerText;
      return {
        hasRawInline: /\$E\s*=\s*mc\^2\$/.test(body),
        hasRawDisplay: /\$\$a\^2\s*\+\s*b\^2\s*=\s*c\^2\$\$/.test(body),
        sample: body.slice(0, 400),
      };
    });
    const noRaw = !rawText.hasRawInline && !rawText.hasRawDisplay;
    result.steps.push({
      step: "no-raw-source",
      ...rawText,
      ok: noRaw,
    });
    if (noRaw) result.passes++;
    else result.failures++;

    // 5. Crop screenshot of the iframe area (this is the headline
    // visual proof — the user-facing bug is "formulas don't render").
    const cardHeader = page.locator("h2:has-text('Vista previa HTML')").first();
    const card = cardHeader.locator("..").locator("..");
    await card.screenshot({ path: SCREENSHOT_PREVIEW });
    result.steps.push({
      step: "screenshot-card",
      path: path.relative(EVIDENCE, SCREENSHOT_PREVIEW),
      ok: true,
    });

    // 6. Full-page screenshot at the required path.
    await page.screenshot({ path: SCREENSHOT_FULL, fullPage: true });
    result.steps.push({
      step: "screenshot-full",
      path: path.relative(EVIDENCE, SCREENSHOT_FULL),
      ok: true,
    });

    // 7. Open the fullscreen modal and screenshot that too — it
    // exercises the second iframe (modalIframeRef).
    try {
      await page.locator('[data-testid="slide-modal-container"]').first().click();
      await page.waitForTimeout(500);
      const modalIframe = page
        .locator('iframe[title="Vista previa de la diapositiva"]')
        .last();
      const modalHandle = await modalIframe.elementHandle();
      const modalFrame = await modalHandle.contentFrame();
      await modalFrame.waitForFunction(
        () => document.querySelectorAll(".katex").length >= 5,
        { timeout: 15000 }
      );
      await page.waitForTimeout(500);
      await page.screenshot({ path: SCREENSHOT_MODAL, fullPage: false });
      result.steps.push({
        step: "screenshot-modal",
        path: path.relative(EVIDENCE, SCREENSHOT_MODAL),
        ok: true,
      });
      // Close the modal so we don't leave it open in case the user
      // re-runs this script.
      await page.keyboard.press("Escape");
    } catch (e) {
      result.steps.push({
        step: "screenshot-modal",
        message: e.message,
        ok: false,
      });
    }
  } catch (e) {
    result.steps.push({ step: "exception", message: e.message, ok: false });
    result.failures++;
  } finally {
    await browser.close();
    // ALWAYS restore the original htmlDesign — even if the test
    // threw — so we don't leave a slide in an unexpected state.
    try {
      await db.slide.update({
        where: { id: slide.id },
        data: { htmlDesign: originalHtml },
      });
      result.steps.push({ step: "restore-html", ok: true });
    } catch (e) {
      result.steps.push({
        step: "restore-html",
        message: e.message,
        ok: false,
      });
      result.failures++;
    }
    await db.$disconnect();
  }

  result.finishedAt = new Date().toISOString();
  result.allPassed = result.failures === 0;
  fs.writeFileSync(VERIFICATION, JSON.stringify(result, null, 2));
  console.log("\n=== F1.4 formula-render verification ===");
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPassed) {
    process.exitCode = 1;
  }
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});

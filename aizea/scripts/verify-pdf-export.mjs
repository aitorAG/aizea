/**
 * v1.7 / Issue 4.1 — PDF export verification.
 *
 * Renders the EXACT same HTML template that `exportAllSlidesPdfAction`
 * produces (top-half slide / bottom-half Guion·Relevancia·Narrativa)
 * with N synthetic slides, writes the resulting PDF to disk, and
 * asserts that:
 *   1. The file starts with the `%PDF-` magic header.
 *   2. The number of `/Type /Page` object references equals N.
 *
 * The script is intentionally DB-free so it can run in CI and on
 * laptops without Postgres. It exercises the same CSS and the same
 * Playwright path the production action uses.
 */
import { chromium } from "playwright";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SLIDES = [
  {
    title: "Introducción",
    description: "Bienvenida al curso",
    htmlDesign:
      '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1e3a8a,#0ea5e9);color:#fff;font-family:system-ui;font-size:80px;font-weight:700;">Slide 1</div>',
    boxes: {
      SCRIPT: "Saludo inicial y objetivos del módulo.",
      RELEVANCE: "Por qué este tema importa.",
      NARRATIVE: "Cuenta una historia corta que enganche.",
    },
  },
  {
    title: "Conceptos clave",
    description: "Definiciones fundamentales",
    htmlDesign:
      '<div style="width:100%;height:100%;padding:40px;background:#fef3c7;color:#111;font-family:system-ui;font-size:64px;font-weight:600;">Slide 2</div>',
    boxes: {
      SCRIPT: "Definir los tres conceptos principales.",
      RELEVANCE: "Aplicación al trabajo diario.",
      NARRATIVE: "Analogía con algo cotidiano.",
    },
  },
  {
    title: "Cierre",
    description: "Resumen y siguientes pasos",
    htmlDesign:
      '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#064e3b;color:#d1fae5;font-family:system-ui;font-size:80px;font-weight:700;">Slide 3</div>',
    boxes: {
      SCRIPT: "Recapitular los puntos principales.",
      RELEVANCE: "Qué cambia en la práctica.",
      NARRATIVE: "Llamada a la acción.",
    },
  },
];

const BOX_LABELS = {
  SCRIPT: "Guion",
  RELEVANCE: "Relevancia",
  NARRATIVE: "Narrativa",
};

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

function buildHtml() {
  const pages = SLIDES.map((s) => {
    const design = stripBom(s.htmlDesign);
    const top = design
      ? `<div class="preview">${design}</div>`
      : `<div class="slide-empty">Sin diseño HTML generado</div>`;
    const bottom = `
        <div class="text-block">
          <h3>${escapeHtml(BOX_LABELS.SCRIPT)}</h3>
          <p>${renderTextBlock(stripBom(s.boxes.SCRIPT))}</p>
        </div>
        <div class="text-block">
          <h3>${escapeHtml(BOX_LABELS.RELEVANCE)}</h3>
          <p>${renderTextBlock(stripBom(s.boxes.RELEVANCE))}</p>
        </div>
        <div class="text-block">
          <h3>${escapeHtml(BOX_LABELS.NARRATIVE)}</h3>
          <p>${renderTextBlock(stripBom(s.boxes.NARRATIVE))}</p>
        </div>`;
    return `<section class="slide-page">${top}<div class="slide-bottom">${bottom}</div></section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Verification PDF</title>
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
.slide-top {
  height: 50%; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  background: #fff;
}
.slide-top iframe, .slide-top .preview {
  width: 210mm; height: 148mm;
  border: none;
  transform-origin: top left;
  transform: scale(0.62);
  width: 1280px; height: 720px;
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
}

const tmpFile = join(tmpdir(), `verify-pdf-${Date.now()}.pdf`);

try {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.setContent(buildHtml(), { waitUntil: "networkidle" });
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    const buffer = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
    });
    await writeFile(tmpFile, buffer);
  } finally {
    await browser.close();
  }

  const bytes = await readFile(tmpFile);
  const head = bytes.subarray(0, 5).toString("ascii");
  const body = bytes.toString("binary");
  // The PDF `/Type /Page` token can be inside a stream; the count of
  // object definitions matching `/Type /Page` (not `/Pages`) is the
  // canonical page count.
  const pageMatches = body.match(/\/Type\s*\/Page(?!s)/g) ?? [];
  const pageCount = pageMatches.length;

  console.log("file:", tmpFile);
  console.log("size:", bytes.length, "bytes");
  console.log("header:", JSON.stringify(head));
  console.log("pageCount:", pageCount, "expected:", SLIDES.length);

  let ok = true;
  if (head !== "%PDF-") {
    console.error("FAIL: missing %PDF- header");
    ok = false;
  }
  if (pageCount !== SLIDES.length) {
    console.error(
      `FAIL: page count mismatch (got ${pageCount}, expected ${SLIDES.length})`
    );
    ok = false;
  }
  if (ok) {
    console.log("PASS: PDF has correct header and page count.");
  }
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error("verify-pdf failed:", err);
  process.exit(1);
} finally {
  try {
    await unlink(tmpFile);
  } catch {}
}

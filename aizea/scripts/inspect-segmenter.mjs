// @ts-check
//
// Replicate the SegmenterService.segment() call on a real material's
// buffer so we can see EXACTLY which branch returns 0 units. The
// current state: materials exist with on-disk files, but the
// pipeline reports "Segmentación completada (0 unidades)".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import pdfParse from "pdf-parse";

const db = new PrismaClient();
const UPLOADS_DIR = join(process.cwd(), "public", "uploads");

async function main() {
  const materialId = process.argv[2];
  if (!materialId) {
    console.error("usage: node scripts/inspect-segmenter.mjs <materialId>");
    process.exit(1);
  }
  const material = await db.material.findUnique({ where: { id: materialId } });
  if (!material) {
    console.error(`material ${materialId} not found`);
    process.exit(1);
  }
  console.log(`material=${material.id}  filename="${material.filename}"`);

  const buffer = readFileSync(join(UPLOADS_DIR, material.filename));
  console.log(`buffer length = ${buffer.length}B`);

  // 1. Text extraction
  console.log(`\n=== PDFService.extractText() ===`);
  const extracted = await pdfParse(buffer);
  console.log(`  pages = ${extracted.numpages}`);
  console.log(`  text length = ${extracted.text.length}`);
  console.log(`  text preview (first 400 chars):`);
  console.log(`    ${JSON.stringify(extracted.text.slice(0, 400))}`);
  console.log(`  text preview (chars 400-800):`);
  console.log(`    ${JSON.stringify(extracted.text.slice(400, 800))}`);
  console.log(`  text preview (last 400 chars):`);
  console.log(`    ${JSON.stringify(extracted.text.slice(-400))}`);

  // 2. Replicate the segmenter's paragraph split (text-only fallback)
  console.log(`\n=== Segmenter fallbackFromText() paragraph split ===`);
  const MIN_CONTENT_LENGTH = 32;
  const paragraphs = extracted.text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= MIN_CONTENT_LENGTH);
  console.log(`  total paragraphs >= 32 chars: ${paragraphs.length}`);
  if (paragraphs.length > 0) {
    console.log(`  first paragraph: ${JSON.stringify(paragraphs[0].slice(0, 200))}`);
    console.log(`  last paragraph: ${JSON.stringify(paragraphs[paragraphs.length - 1].slice(0, 200))}`);
  }

  // 3. Check raw newlines
  console.log(`\n=== Raw newline analysis ===`);
  const allLines = extracted.text.split("\n");
  console.log(`  total lines = ${allLines.length}`);
  console.log(`  lines with length >= 32: ${allLines.filter((l) => l.trim().length >= MIN_CONTENT_LENGTH).length}`);
  console.log(`  longest line length: ${Math.max(0, ...allLines.map((l) => l.length))}`);
  console.log(`  median line length: ${(() => {
    const sorted = [...allLines.map((l) => l.length)].sort((a, b) => a - b);
    return sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0;
  })()}`);

  // 4. Try LayoutParser (docling-serve) so we know which branch the
  //    segmenter takes.
  console.log(`\n=== LayoutParser.parse() ===`);
  const baseUrl =
    process.env.DOCLING_SERVE_URL ?? "http://localhost:5001";
  console.log(`  baseUrl = ${baseUrl}`);
  const fd = new FormData();
  fd.append("files", new Blob([new Uint8Array(buffer)]), `${material.filename}`);
  fd.append("from_formats", "pdf");
  fd.append("to_formats", "json");
  fd.append("target_type", "inbody");
  let structure = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(`${baseUrl}/v1/convert/file`, {
      method: "POST",
      body: fd,
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.ok) {
      const payload = await res.json();
      const json = payload?.document?.json_content;
      const pageCount = json?.pages
        ? Array.isArray(json.pages)
          ? json.pages.length
          : Object.keys(json.pages).length
        : 0;
      const texts = Array.isArray(json?.texts) ? json.texts : [];
      const sections = texts.filter((t) => t?.label === "section_header");
      structure = {
        pageCount,
        hasStructuralMarkup: sections.length > 0,
        sectionCount: sections.length,
        sectionTitles: sections.slice(0, 8).map((s) => s.text ?? s.orig),
      };
    } else {
      structure = { httpError: `${res.status} ${res.statusText}` };
    }
  } catch (err) {
    structure = { error: err instanceof Error ? err.message : String(err) };
  }
  console.log(`  result: ${JSON.stringify(structure, null, 2)}`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error("inspect-segmenter failed:", err);
  process.exit(1);
});

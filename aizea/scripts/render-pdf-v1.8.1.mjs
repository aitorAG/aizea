// @ts-check
// Visual QA — render the first page of the exported PDF to verify
// the slide fits within A4 boundaries (no vertical overflow).

import { chromium } from "playwright";
import { readFileSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EVIDENCE_DIR = join(process.cwd(), ".test-artifacts", "evidence", "v1.8.1");
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

async function main() {
  const pdfPath = join(EVIDENCE_DIR, "6-export.pdf");
  if (!existsSync(pdfPath)) {
    console.error("PDF not found at", pdfPath);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 794, height: 1123 },
    });
    const page = await context.newPage();
    const pdfData = readFileSync(pdfPath);
    const dataUrl = `data:application/pdf;base64,${pdfData.toString("base64")}`;
    await page.goto(dataUrl, { waitUntil: "load", timeout: 30_000 });
    await page.waitForTimeout(2_000);
    await page.screenshot({
      path: join(EVIDENCE_DIR, "6-02-pdf-rendered.png"),
      fullPage: false,
    });
    console.log("Rendered PDF to 6-02-pdf-rendered.png");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

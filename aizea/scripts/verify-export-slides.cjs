// Visual + functional verification of the export-slides feature.
//
// Usage (with dev server running on http://localhost:3000):
//   node scripts/verify-export-slides.cjs
//
// Captures:
//   - screenshots/slide-detail-with-buttons.png   full page screenshot
//   - screenshots/buttons-only.png                 zoom on the toolbar
//   - exports/sample-slide.html                   downloaded HTML file
//   - exports/sample-course.pdf                   downloaded PDF file
//   - verification.json                           pass/fail summary

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const EVIDENCE = path.resolve(__dirname, "..", ".test-artifacts", "evidence", "export-slides");
const SCREENSHOTS = path.join(EVIDENCE, "screenshots");
const EXPORTS = path.join(EVIDENCE, "exports");
for (const d of [SCREENSHOTS, EXPORTS]) fs.mkdirSync(d, { recursive: true });

const SLIDE_ID = "1f663944-200d-4661-8f0b-03181d4d61b6";
const COURSE_ID = "3d416e2a-e498-42d8-a539-0d49c08d3e0b";
const BASE = "http://localhost:3000";

async function main() {
  const result = {
    startedAt: new Date().toISOString(),
    steps: [],
    passes: 0,
    failures: 0,
  };

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();

  // Surface server-action errors to the console so we don't miss them.
  page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("CONSOLE ERROR:", msg.text());
  });

  try {
    // Step 1: navigate to the slide detail page
    const url = `${BASE}/courses/${COURSE_ID}/slides/${SLIDE_ID}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 });
    result.steps.push({ step: "navigate", url, ok: true });

    // Step 2: confirm the new export buttons are rendered
    const htmlBtn = page.getByTestId("export-html-button");
    const pdfBtn = page.getByTestId("export-pdf-button");
    await htmlBtn.waitFor({ state: "visible", timeout: 10000 });
    await pdfBtn.waitFor({ state: "visible", timeout: 10000 });
    result.steps.push({ step: "buttons-visible", ok: true });
    result.passes += 2;

    // Step 3: full-page screenshot (shows the buttons in context)
    await page.screenshot({
      path: path.join(SCREENSHOTS, "slide-detail-with-buttons.png"),
      fullPage: false,
    });
    result.steps.push({
      step: "screenshot-full",
      path: "screenshots/slide-detail-with-buttons.png",
      ok: true,
    });

    // Step 4: tight zoom on the toolbar with the three icons
    const cardHeader = page.locator("h2:has-text('Vista previa HTML')").first();
    const card = cardHeader.locator("..");
    await card.screenshot({
      path: path.join(SCREENSHOTS, "buttons-only.png"),
    });
    result.steps.push({
      step: "screenshot-buttons",
      path: "screenshots/buttons-only.png",
      ok: true,
    });

    // Step 5: click the HTML export button and capture the download
    const [htmlDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      htmlBtn.click(),
    ]);
    const htmlPath = path.join(EXPORTS, "sample-slide.html");
    await htmlDownload.saveAs(htmlPath);
    const htmlContent = fs.readFileSync(htmlPath, "utf-8");
    const htmlOk =
      htmlContent.startsWith("<!doctype html>") &&
      htmlContent.includes("Propiedades de los fluidos");
    result.steps.push({
      step: "html-export",
      path: "exports/sample-slide.html",
      bytes: htmlContent.length,
      filename: htmlDownload.suggestedFilename(),
      hasDoctype: htmlContent.toLowerCase().startsWith("<!doctype html>"),
      hasTitle: htmlContent.includes("Propiedades de los fluidos"),
      ok: htmlOk,
    });
    if (htmlOk) result.passes++;
    else result.failures++;

    // Step 6: click the PDF export button and capture the download
    const [pdfDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 120000 }),
      pdfBtn.click(),
    ]);
    const pdfPath = path.join(EXPORTS, "sample-course.pdf");
    await pdfDownload.saveAs(pdfPath);
    const pdfBuffer = fs.readFileSync(pdfPath);
    const isPdfMagic = pdfBuffer.slice(0, 5).toString() === "%PDF-";
    // Count pages via /Type /Page (one per page, except /Pages)
    const pdfText = pdfBuffer.toString("latin1");
    const pageMatches = pdfText.match(/\/Type\s*\/Page(?!s)/g) || [];
    result.steps.push({
      step: "pdf-export",
      path: "exports/sample-course.pdf",
      bytes: pdfBuffer.length,
      filename: pdfDownload.suggestedFilename(),
      isPdfMagic,
      pageCount: pageMatches.length,
      ok: isPdfMagic && pageMatches.length > 0,
    });
    if (isPdfMagic && pageMatches.length > 0) result.passes++;
    else result.failures++;
  } catch (e) {
    result.steps.push({ step: "exception", message: e.message, ok: false });
    result.failures++;
  } finally {
    await browser.close();
  }

  result.finishedAt = new Date().toISOString();
  result.allPassed = result.failures === 0;
  fs.writeFileSync(
    path.join(EVIDENCE, "verification.json"),
    JSON.stringify(result, null, 2)
  );
  console.log("\n=== Verification summary ===");
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPassed) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

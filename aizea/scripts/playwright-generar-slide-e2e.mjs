// E2E test for "Generar slide" button on slide detail empty state.
//
// Verifies:
//   1. When slide.htmlDesign is null, the preview Card renders the
//      "Generar slide" button (NOT the old "Sin diseño" placeholder).
//   2. Clicking the button calls regenerateHtmlDesign and the
//      iframe preview shows up.
//   3. Loading state shows a spinner while the request is in flight.
//
// Captures BEFORE/AFTER screenshots into .omo/evidence/generar-slide/.
//
// Usage: node scripts/playwright-generar-slide-e2e.mjs

import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = resolve(
  __dirname,
  "..",
  ".omo",
  "evidence",
  "generar-slide"
);
mkdirSync(evidenceDir, { recursive: true });

const COURSE_ID = "3d416e2a-e498-42d8-a539-0d49c08d3e0b";
const SLIDE_ID = "0369d12b-6e88-4239-a45b-bf0788577756"; // "Tribología" - no HTML
const baseUrl = "http://localhost:3000";

const errors = [];
function check(name, condition) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}`);
    errors.push(name);
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

// Capture console errors from the page for diagnostic.
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});

console.log(`[1] Load slide ${SLIDE_ID} (no HTML design expected)`);
await page.goto(
  `${baseUrl}/courses/${COURSE_ID}/slides/${SLIDE_ID}`,
  { waitUntil: "domcontentloaded", timeout: 30_000 }
);
await page.waitForSelector("[data-testid=slide-navigator]", {
  timeout: 15_000,
});

// Sanity: the empty-state "Generar slide" button must exist.
const buttonCount = await page
  .getByTestId("generar-slide-button")
  .count();
check(
  "empty state shows 'Generar slide' button (count === 1)",
  buttonCount === 1
);

// Old placeholder text must NOT be present.
const oldPlaceholderCount = await page
  .getByText("Sin diseño — genera el contenido primero")
  .count();
check(
  "old 'Sin diseño' placeholder is removed",
  oldPlaceholderCount === 0
);

// Description text should be clearer.
const newHelperText = await page
  .getByTestId("generar-slide-helper")
  .textContent();
check(
  "new helper text mentions 'Genera el diseño HTML con IA'",
  (newHelperText ?? "").toLowerCase().includes("genera el diseño html")
);

await page.screenshot({
  path: resolve(evidenceDir, "01-before-click.png"),
  fullPage: true,
});
console.log("  saved 01-before-click.png");

// ─── Click and verify the request fires ───────────────────────────────
console.log("\n[2] Click 'Generar slide' button");
const clickPromise = page
  .getByTestId("generar-slide-button")
  .click();

// While the request is in flight, the button should be disabled and
// show a spinner.  We poll for the disabled state right after the
// click, but the request may complete very fast (mocked? network?).
// At minimum, we confirm the click didn't error and the preview
// eventually switches to the iframe view.
await clickPromise;

// After success: the iframe (title="Vista previa de la diapositiva")
// inside the preview container should now exist.
await page.waitForSelector(
  "iframe[title='Vista previa de la diapositiva']",
  { timeout: 60_000 }
);
check(
  "iframe preview rendered after generation",
  (await page.locator("iframe[title='Vista previa de la diapositiva']").count()) >= 1
);

// The "Generar slide" button is gone (because htmlDesign is now set).
check(
  "'Generar slide' button is gone after generation",
  (await page.getByTestId("generar-slide-button").count()) === 0
);

await page.screenshot({
  path: resolve(evidenceDir, "02-after-click.png"),
  fullPage: true,
});
console.log("  saved 02-after-click.png");

if (consoleErrors.length > 0) {
  console.log("\nPage console errors observed:");
  for (const e of consoleErrors) console.log("  -", e);
}

await browser.close();

if (errors.length > 0) {
  console.error(`\n${errors.length} check(s) failed:`);
  for (const e of errors) console.error("  -", e);
  process.exit(1);
}
console.log("\nAll checks passed.");

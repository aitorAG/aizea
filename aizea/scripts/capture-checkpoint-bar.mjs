// Capture Playwright screenshots of the CheckpointBar on each of the
// four course pages, plus a "narrow viewport" mobile variant. Writes
// PNGs to .test-artifacts/evidence/checkpoint-bar/ and asserts the bar's data
// attributes so a regression that breaks the phase detection fails
// the test rather than silently shipping a broken screenshot.
//
// Usage:
//   node scripts/capture-checkpoint-bar.mjs scripts/.course-snapshot.json
//
// Reads a real (courseId, slideId) pair from the snapshot so the
// detail page isn't a 404.

import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath = process.argv[2] ?? "scripts/.course-snapshot.json";
const evidenceDir = resolve(
  __dirname,
  "..",
  "..",
  ".test-artifacts",
  "evidence",
  "checkpoint-bar"
);
mkdirSync(evidenceDir, { recursive: true });

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
if (!snapshot.courses.length) {
  throw new Error("No courses in the snapshot — run a course seed first.");
}
const course = snapshot.courses.find((c) => c.materialCount > 0) ??
  snapshot.courses[0];
if (!course) throw new Error("No course available.");
const slide = snapshot.slides.find((s) => s.courseId === course.id);
const courseId = course.id;

const routes = [
  { name: "01-phase-1-materials", path: "/materials" },
  { name: "02-phase-2-tree", path: "/tree" },
  { name: "03-phase-3-slides", path: "/slides" },
];
if (slide) {
  routes.push({ name: "04-phase-4-slide-detail", path: `/slides/${slide.id}` });
}

const baseUrl = "http://localhost:3000";
const browser = await chromium.launch();

// Two viewports: desktop and a mobile size that exercises the
// responsive label sizing.
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844 },
];

const errors = [];
for (const vp of viewports) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  for (const r of routes) {
    const url = `${baseUrl}/courses/${courseId}${r.path}`;
    console.log(`[${vp.name}] ${url}`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    } catch (err) {
      // Some pages (e.g. tree) can throw if the course has no tree,
      // but the CheckpointBar is mounted by the layout and will be
      // in the DOM regardless of the page's own data state.
      console.warn(
        `[${vp.name}] goto error (continuing to assert bar presence): ${err.message}`
      );
    }
    // Wait for the bar to mount — it's a client component that
    // re-renders on hydration. Allow a moment for hot-reload.
    await page.waitForSelector("[data-testid=checkpoint-bar]", { timeout: 10_000 });

    // Dismiss any leftover GlobalPipelineBanner notifications so the
    // screenshots are clean. The banner's close button is accessible
    // by name; clicking it doesn't change the bar's behaviour but
    // it removes visual noise that hides the bar in dev.
    let closeButtons = await page.$$('button[aria-label="Cerrar banner"]');
    while (closeButtons.length > 0) {
      await closeButtons[0].click();
      await page.waitForTimeout(150);
      closeButtons = await page.$$('button[aria-label="Cerrar banner"]');
    }
    // Verify the current phase attribute matches the route. The
    // route name encodes the phase as "0N-phase-N-..." — extract
    // the phase from the path instead of the name so future renames
    // of the screenshot file don't silently invalidate the check.
    const expected = Number(
      {
        "/materials": 1,
        "/tree": 2,
        "/slides": 3,
      }[r.path] ?? (r.path.startsWith("/slides/") ? 4 : 0)
    );
    const currentPhase = await page.getAttribute(
      "[data-testid=checkpoint-bar]",
      "data-current-phase"
    );
    if (Number(currentPhase) !== expected) {
      errors.push(
        `[${vp.name}] ${r.path}: expected current-phase=${expected} but got ${currentPhase}`
      );
    }
    // Crop the screenshot to the bottom 200px so the bar is the
    // subject of the image. On mobile the bar takes ~64px; on
    // desktop it takes the same.
    const fullPath = resolve(evidenceDir, `${r.name}-${vp.name}.png`);
    await page.screenshot({
      path: fullPath,
      clip: { x: 0, y: vp.height - 200, width: vp.width, height: 200 },
      fullPage: false,
    });
    // Also a full-page version for the final report.
    const fullPagePath = resolve(
      evidenceDir,
      `${r.name}-${vp.name}-full.png`
    );
    await page.screenshot({ path: fullPagePath, fullPage: true });
  }
  await ctx.close();
}

await browser.close();
if (errors.length) {
  console.error("FAIL: phase mismatches detected");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log(`OK: wrote screenshots to ${evidenceDir}`);

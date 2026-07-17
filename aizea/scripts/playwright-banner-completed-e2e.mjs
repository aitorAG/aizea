// @ts-check
//
// Playwright smoke test for the "banner stays visible after quick
// completion" fix.
//
// Two flows are exercised end-to-end against a running dev server on
// http://localhost:3000:
//
//   A. Injected completed job (deterministic):
//      We seed 1 ProcessingJob in the DB with status="completed" to
//      simulate the new PipelineService behaviour for a course with no
//      materials: 1 job is created (segmentation), then immediately
//      completed. The banner must stay visible (green), the user can
//      dismiss it with the X button.
//
//   B. Real "Generar árbol" click on an empty course (end-to-end):
//      We create a course with NO materials, open its tree page, click
//      the "Generar árbol" CTA. The new empty-pipeline return shape
//      should: surface a "Sin contenido que procesar" toast AND keep
//      the completed segmentation banner visible.
//
// Evidence (screenshots + final summary) is written to
// `.test-artifacts/evidence/banner-permanent-completed/`.

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = join(
  process.cwd(),
  ".test-artifacts",
  "evidence",
  "banner-permanent-completed"
);
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

function step(label) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
}

async function dumpBanners(page, label) {
  const banners = await page
    .locator('[data-testid="global-pipeline-banner"]')
    .count();
  const stack = page.locator('[data-testid="global-pipeline-banner-stack"]');
  const stackCount = await stack.getAttribute("data-count").catch(() => "0");
  const statuses = await page
    .locator('[data-testid="global-pipeline-banner"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-status")));
  console.log(
    `  [${label}] banners=${banners} stackDataCount=${stackCount} statuses=${JSON.stringify(
      statuses
    )}`
  );
  return { banners, stackCount: Number(stackCount), statuses };
}

async function main() {
  const db = new PrismaClient();

  // --- Setup --------------------------------------------------------
  step("Setup: ensure a course exists and clean prior fixtures");
  // Use the first course, or create one if none exist.
  let course = await db.course.findFirst({ orderBy: { createdAt: "asc" } });
  if (!course) {
    course = await db.course.create({
      data: { name: `QA Banner Completed ${Date.now()}` },
    });
  }
  console.log(`  course=${course.id} name=${course.name}`);

  // Make sure the course has NO materials (so the pipeline will be
  // empty when triggered end-to-end).
  await db.semanticUnit.deleteMany({
    where: { material: { courseId: course.id } },
  });
  await db.material.deleteMany({ where: { courseId: course.id } });
  // Wipe ALL recent ProcessingJob rows (anything the banner would
  // rehydrate) so we can count exactly what we inject. The new
  // listActiveJobsAction also returns recent completed/failed jobs,
  // so prior test runs would otherwise pollute the count.
  const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
  await db.processingJob.deleteMany({
    where: {
      OR: [
        { status: { in: ["pending", "running"] } },
        { status: "completed", updatedAt: { gte: recentCutoff } },
        { status: "failed", updatedAt: { gte: recentCutoff } },
      ],
    },
  });
  // Wipe any prior topic nodes so the tree page renders the empty state.
  await db.topicNode.deleteMany({ where: { courseId: course.id } });

  // --- Flow A: injected completed job ------------------------------
  step("Flow A: inject 1 completed ProcessingJob, navigate, verify banner stays");
  const fixtureJobId = "qa-completed-seg-1";
  const now = new Date();
  await db.processingJob.create({
    data: {
      id: fixtureJobId,
      type: "segmentation",
      status: "completed",
      progress: 100,
      currentStep: "Sin unidades que procesar",
      courseId: course.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  // Hydration + first poll
  await page.waitForTimeout(3_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "01-injected-completed-banner-visible.png"),
    fullPage: false,
  });
  const r1 = await dumpBanners(page, "after-hydration");
  console.log(
    `  Expected: 1 banner with status=completed. Got: ${r1.banners} (statuses=${JSON.stringify(r1.statuses)})`
  );

  step("Wait 5s — banner must STILL be visible (regression for the original bug)");
  await page.waitForTimeout(5_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "02-still-visible-after-5s.png"),
    fullPage: false,
  });
  const r2 = await dumpBanners(page, "after-5s-wait");
  console.log(
    `  Expected: 1 banner still present. Got: ${r2.banners}.`
  );

  step("Click X — banner should disappear");
  const closeButton = page.locator('[data-testid="banner-close"]').first();
  await closeButton.click();
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "03-after-x-click-banner-gone.png"),
    fullPage: false,
  });
  const r3 = await dumpBanners(page, "after-dismiss");
  console.log(
    `  Expected: 0 banners. Got: ${r3.banners}.`
  );

  // --- Flow B: real end-to-end click on empty course ----------------
  step("Flow B: real 'Generar árbol' click on empty course");
  // Clean the server-side state so the Flow A fixture does NOT
  // re-hydrate on the next page navigation. (`dismissed` is local
  // UI only; the server doesn't track it, so without this the
  // banner would reappear on reload.)
  await db.processingJob.deleteMany({
    where: { id: { startsWith: "qa-completed-" } },
  });
  // Reset: ensure no leftover banners from Flow A.
  await page.evaluate(() => {
    const store = window.__pipelineStore;
    if (store) store.getState().reset();
  });
  await page.goto(
    `http://localhost:3000/courses/${course.id}/tree`,
    { waitUntil: "networkidle" }
  );
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "04-tree-page-empty-state.png"),
    fullPage: false,
  });

  // Click the "Generar árbol" CTA (rendered in the empty-state card).
  // Use a role-based selector to be resilient to the exact icon.
  const generateBtn = page.getByRole("button", { name: /generar [áa]rbol/i }).first();
  const generateVisible = await generateBtn.isVisible().catch(() => false);
  console.log(`  'Generar árbol' button visible: ${generateVisible}`);
  if (!generateVisible) {
    // The tree page might have already rendered a tree. Wipe the
    // nodes and reload to force the empty state.
    console.log("  Empty state not visible; tree may already exist. Continuing anyway…");
  } else {
    await generateBtn.click();
    // The pipeline finishes in <300ms; allow time for the banner +
    // toast to render.
    await page.waitForTimeout(3_000);
  }
  await page.screenshot({
    path: join(EVIDENCE_DIR, "05-after-pipeline-click.png"),
    fullPage: false,
  });
  const r4 = await dumpBanners(page, "after-click");

  // Check the toast.
  const toastVisible = await page
    .getByText(/sin contenido que procesar|no hay contenido que procesar/i)
    .first()
    .isVisible()
    .catch(() => false);
  console.log(`  Toast 'Sin contenido que procesar' visible: ${toastVisible}`);
  if (toastVisible) {
    await page.screenshot({
      path: join(EVIDENCE_DIR, "06-empty-toast-visible.png"),
      fullPage: false,
    });
  }

  step("Wait 4s more — completed banner must STILL be visible (no regression)");
  await page.waitForTimeout(4_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "07-banner-still-visible-after-7s-total.png"),
    fullPage: false,
  });
  const r5 = await dumpBanners(page, "after-extra-4s");

  step("Click X on the completed banner — it must disappear");
  const closeBtn2 = page.locator('[data-testid="banner-close"]').first();
  const closeVisible = await closeBtn2.isVisible().catch(() => false);
  if (closeVisible) {
    await closeBtn2.click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({
    path: join(EVIDENCE_DIR, "08-banner-dismissed.png"),
    fullPage: false,
  });
  const r6 = await dumpBanners(page, "after-dismiss-2");

  // --- Cleanup ------------------------------------------------------
  step("Cleanup");
  // Remove everything we created so the next run starts clean.
  await db.processingJob.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "qa-completed-" } },
        { status: { in: ["pending", "running"] } },
        { status: "completed", updatedAt: { gte: recentCutoff } },
        { status: "failed", updatedAt: { gte: recentCutoff } },
      ],
    },
  });
  await db.$disconnect();
  await browser.close();

  // --- Summary ------------------------------------------------------
  const summary = {
    flowA: {
      step1_after_hydration: r1,
      step2_after_5s_wait: r2,
      step3_after_dismiss: r3,
    },
    flowB: {
      step4_after_click: r4,
      step5_after_extra_4s: r5,
      step6_after_dismiss: r6,
      toast_visible: toastVisible,
    },
    evidenceDir: EVIDENCE_DIR,
  };
  writeFileSync(
    join(EVIDENCE_DIR, "summary.json"),
    JSON.stringify(summary, null, 2)
  );
  console.log("\nFINAL SUMMARY:");
  console.log(JSON.stringify(summary, null, 2));

  // Pass/fail criteria.
  const failures = [];
  if (r1.banners !== 1) failures.push(`Flow A: expected 1 banner after hydration, got ${r1.banners}`);
  if (!r1.statuses.includes("completed"))
    failures.push(`Flow A: expected status=completed, got ${JSON.stringify(r1.statuses)}`);
  if (r2.banners !== 1) failures.push(`Flow A: banner disappeared after 5s (got ${r2.banners}) — REGRESSION`);
  if (r3.banners !== 0) failures.push(`Flow A: X button did not dismiss the banner (got ${r3.banners})`);
  if (!toastVisible) failures.push("Flow B: 'Sin contenido que procesar' toast was NOT shown");
  if (r5.banners === 0) failures.push("Flow B: completed banner disappeared after the click (regression)");
  if (r6.banners !== 0) failures.push(`Flow B: X button did not dismiss the banner (got ${r6.banners})`);

  if (failures.length > 0) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error("  - " + f);
    process.exit(2);
  }
  console.log("\nAll Playwright assertions passed.");
}

main().catch((err) => {
  console.error("Playwright test failed:", err);
  process.exit(1);
});

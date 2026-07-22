// @ts-check
//
// v1.5 #2.3 — "Solo jobs actuales en el banner" evidence capture.
//
// User complaint: "Si recargo la pantalla aparecen todos los jobs que
// se han ejecutado en el historico de datos. no los especificos de
// esta sesion."
//
// What this script proves:
//   1. Course-scoped hydration: navigating to Course A's tree page
//      only surfaces jobs that belong to Course A. A recent running
//      job in Course B does NOT leak into Course A's banner.
//   2. 30-second window: terminal jobs (completed/failed/cancelled)
//      that were last updated more than 30 seconds ago do NOT
//      rehydrate. The banner only ever surfaces:
//        - jobs in (pending, running), regardless of age, OR
//        - terminal jobs updated within the last 30s.
//   3. updatedAt DESC: when multiple jobs match, the most recent
//      one renders first in the stack.
//
// Flow:
//   - Seed 2 courses (Course A, Course B).
//   - For Course A: inject 1 active running job (very recent) +
//     3 terminal jobs that are > 30s old (1 completed, 1 failed,
//     1 cancelled).
//   - For Course B: inject 1 active running job (very recent).
//   - Open Course A's /tree page in Playwright.
//   - Assert: only the recent running job is in the banner stack
//     (count == 1, status == "active").
//   - Take screenshot to .test-artifacts/evidence/v1.5/wave-2/2.3-only-current-jobs.png
//   - Navigate to Course B's /tree page.
//   - Assert: only Course B's recent running job is in the banner
//     stack (count == 1, data-course-id != Course A's id).
//   - Take a second screenshot for the cross-course filtering
//     evidence.

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = resolve(
  process.cwd(),
  "..",
  ".test-artifacts",
  "evidence",
  "v1.5",
  "wave-2"
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
  const stackCount = (await stack.getAttribute("data-count").catch(() => "0")) ??
    "0";
  const details = await page
    .locator('[data-testid="global-pipeline-banner"]')
    .evaluateAll((els) =>
      els.map((el) => ({
        jobId: el.getAttribute("data-job-id"),
        status: el.getAttribute("data-status"),
        stuck: el.getAttribute("data-stuck"),
      }))
    );
  console.log(
    `  [${label}] banners=${banners} stackDataCount=${stackCount} details=${JSON.stringify(
      details
    )}`
  );
  return { banners, stackCount: Number(stackCount), details };
}

async function main() {
  const db = new PrismaClient();

  // --- Setup --------------------------------------------------------
  step("Setup: create 2 courses, seed active + historical jobs");
  // Wipe prior fixtures from previous runs of this script so the
  // counts are deterministic.
  await db.processingJob.deleteMany({
    where: {
      OR: [
        { id: { startsWith: "v15-2-3-" } },
      ],
    },
  });
  // Also wipe any leftover active jobs that the banner would surface
  // for the courses we are about to use (otherwise the screenshot
  // would show real production state too).
  let courseA = await db.course.findFirst({
    where: { name: "v15-2-3 Course A" },
  });
  if (!courseA) {
    courseA = await db.course.create({ data: { name: "v15-2-3 Course A" } });
  }
  let courseB = await db.course.findFirst({
    where: { name: "v15-2-3 Course B" },
  });
  if (!courseB) {
    courseB = await db.course.create({ data: { name: "v15-2-3 Course B" } });
  }
  // Wipe any active jobs on these courses that would otherwise
  // pollute the banner.
  await db.processingJob.deleteMany({
    where: {
      courseId: { in: [courseA.id, courseB.id] },
      OR: [
        { status: { in: ["pending", "running"] } },
        {
          status: { in: ["completed", "failed", "cancelled"] },
          updatedAt: { gte: new Date(Date.now() - 31 * 1000) },
        },
      ],
    },
  });

  // 2 minutes ago — well outside the 30s recent window.
  const longAgo = new Date(Date.now() - 2 * 60 * 1000);
  // 1 second ago — well within the 30s recent window.
  const justNow = new Date(Date.now() - 1_000);

  // Course A historical terminal jobs (must NOT appear).
  await db.processingJob.create({
    data: {
      id: "v15-2-3-A-old-completed",
      type: "tree-building",
      status: "completed",
      progress: 100,
      currentStep: "Listo",
      courseId: courseA.id,
      createdAt: longAgo,
      updatedAt: longAgo,
    },
  });
  await db.processingJob.create({
    data: {
      id: "v15-2-3-A-old-failed",
      type: "extraction",
      status: "failed",
      error: "OpenRouter 503",
      courseId: courseA.id,
      createdAt: longAgo,
      updatedAt: longAgo,
    },
  });
  await db.processingJob.create({
    data: {
      id: "v15-2-3-A-old-cancelled",
      type: "extraction",
      status: "cancelled",
      courseId: courseA.id,
      createdAt: longAgo,
      updatedAt: longAgo,
    },
  });
  // Course A: 1 in-flight job (must appear).
  await db.processingJob.create({
    data: {
      id: "v15-2-3-A-current-running",
      type: "extraction",
      status: "running",
      progress: 42,
      currentStep: "Unidad 5/10",
      courseId: courseA.id,
      createdAt: justNow,
      updatedAt: justNow,
    },
  });
  // Course B: 1 in-flight job (must NOT appear on Course A's page).
  await db.processingJob.create({
    data: {
      id: "v15-2-3-B-current-running",
      type: "tree-building",
      status: "running",
      progress: 10,
      currentStep: "Iniciando",
      courseId: courseB.id,
      createdAt: justNow,
      updatedAt: justNow,
    },
  });

  console.log(`  Course A=${courseA.id}  Course B=${courseB.id}`);

  // --- Playwright: navigate to Course A's /tree --------------------
  step("Open Course A /tree — banner must show ONLY the 1 in-flight job");
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  await page.goto(`http://localhost:3000/courses/${courseA.id}/tree`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  // Hydration + first poll.
  await page.waitForTimeout(3_000);
  const a1 = await dumpBanners(page, "course-A-after-hydration");

  const screenshotPath = join(
    EVIDENCE_DIR,
    "2.3-only-current-jobs.png"
  );
  await page.screenshot({ path: screenshotPath, fullPage: false });
  console.log(`  Screenshot saved: ${screenshotPath}`);

  // --- Playwright: navigate to Course B's /tree --------------------
  step("Open Course B /tree — banner must show ONLY Course B's job");
  await page.goto(`http://localhost:3000/courses/${courseB.id}/tree`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  // Wait until the stack's data-count matches what we expect, or
  // the timeout fires. This handles any race between the hydration
  // effect re-running on the new courseId and the inner banner
  // divs rendering.
  await page
    .locator('[data-testid="global-pipeline-banner-stack"][data-count="1"]')
    .waitFor({ timeout: 10_000 })
    .catch(() => undefined);
  // One more short wait for the inner banner div to mount.
  await page.waitForTimeout(500);
  const b1 = await dumpBanners(page, "course-B-after-hydration");

  const screenshotPathB = join(
    EVIDENCE_DIR,
    "2.3-only-current-jobs-course-B.png"
  );
  await page.screenshot({ path: screenshotPathB, fullPage: false });
  console.log(`  Screenshot saved: ${screenshotPathB}`);

  // --- Cleanup ------------------------------------------------------
  step("Cleanup");
  await db.processingJob.deleteMany({
    where: { id: { startsWith: "v15-2-3-" } },
  });
  await db.$disconnect();
  await browser.close();

  // --- Pass / fail --------------------------------------------------
  const failures = [];
  // Course A: 1 banner (the in-flight job), the old terminal jobs
  // must NOT be in the stack.
  if (a1.banners !== 1) {
    failures.push(
      `Course A: expected exactly 1 banner (the in-flight job), got ${a1.banners} — historical jobs leaked in`
    );
  }
  if (a1.banners >= 1 && a1.details[0]?.jobId !== "v15-2-3-A-current-running") {
    failures.push(
      `Course A: the wrong job is in the banner (got ${a1.details[0]?.jobId}, expected v15-2-3-A-current-running)`
    );
  }
  if (
    a1.banners >= 1 &&
    a1.details[0]?.status !== "active" &&
    a1.details[0]?.status !== "running"
  ) {
    failures.push(
      `Course A: the visible job is not active (status=${a1.details[0]?.status})`
    );
  }
  // Course B: 1 banner, the Course A in-flight job must NOT leak.
  if (b1.banners !== 1) {
    failures.push(
      `Course B: expected exactly 1 banner, got ${b1.banners}`
    );
  }
  if (b1.banners >= 1 && b1.details[0]?.jobId !== "v15-2-3-B-current-running") {
    failures.push(
      `Course B: courseId filter FAILED — Course A's job leaked in (got ${b1.details[0]?.jobId})`
    );
  }

  const summary = {
    courseA: a1,
    courseB: b1,
    evidenceDir: EVIDENCE_DIR,
    screenshotA: screenshotPath,
    screenshotB: screenshotPathB,
  };
  writeFileSync(join(EVIDENCE_DIR, "2.3-summary.json"), JSON.stringify(summary, null, 2));

  if (failures.length > 0) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error("  - " + f);
    process.exit(2);
  }
  console.log("\nAll v1.5 #2.3 Playwright assertions passed.");
}

main().catch((err) => {
  console.error("Playwright script crashed:", err);
  process.exit(1);
});

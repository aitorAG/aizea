// @ts-check
//
// v1.11 — End-to-end evidence collection for the Jobs panel
// (sidebar + /jobs page + hover preview + nav button badge).
//
// The script seeds the dev DB with two test courses and a
// realistic mix of active + finished ProcessingJob rows so the
// screenshots show:
//   1. The nav bar with the new "Trabajos" button (with badge).
//   2. The hover preview (anchored to the nav button).
//   3. The right-side drawer (sidebar) with the "Activos" tab.
//   4. The "Finalizados" tab inside the same drawer.
//   5. The dedicated /jobs page with the same content.
//
// We DO NOT drive the panel via the in-memory stores (the panel
// reads from the server actions, not the client stores) — we seed
// the DB directly so the polling loop sees the real data and the
// evidence is reproducible without races.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, "../.test-artifacts/evidence/v1.11");
const SERVER = process.env.AIZEA_SERVER ?? "http://localhost:3100";

const COURSE_A = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Física Cuántica",
};
const COURSE_B = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Matemáticas Discretas",
};

// Active jobs: one pipeline run for course A (multiple phase jobs
// so the grouping logic is exercised) + one running slide
// generation for course B.
const ACTIVE_JOBS = [
  {
    id: "job-active-seg",
    type: "segmentation",
    status: "running",
    progress: 35,
    currentStep: "Segmentando páginas 12-18…",
    courseId: COURSE_A.id,
    updatedAtAgoMs: 800,
  },
  {
    id: "job-active-ext",
    type: "extraction",
    status: "running",
    progress: 60,
    currentStep: "Extrayendo conceptos de la unidad 4",
    courseId: COURSE_A.id,
    updatedAtAgoMs: 600,
  },
  {
    id: "job-active-tree",
    type: "tree-building",
    status: "running",
    progress: 12,
    currentStep: "Construyendo árbol conceptual…",
    courseId: COURSE_A.id,
    updatedAtAgoMs: 1200,
  },
  {
    id: "job-active-slide-gen",
    type: "slide-generation",
    status: "running",
    progress: 80,
    currentStep: "Generando 12 de 15 diapositivas",
    courseId: COURSE_B.id,
    updatedAtAgoMs: 400,
  },
];

// Finished jobs: a mix of completed, failed, and cancelled, all
// updated within the last 5 minutes (so they fall in the
// `listFinishedJobsAction` window).
const FINISHED_JOBS = [
  {
    id: "job-finished-merge",
    type: "tree-building",
    status: "completed",
    progress: 100,
    currentStep: "Árbol generado con 24 nodos",
    courseId: COURSE_A.id,
    updatedAtAgoMs: 30_000, // 30s ago
  },
  {
    id: "job-finished-fail",
    type: "extraction",
    status: "failed",
    progress: 42,
    currentStep: "Fallo al extraer la unidad 7",
    courseId: COURSE_B.id,
    error: "OpenRouter devolvió 429 (rate limit).",
    updatedAtAgoMs: 90_000, // 90s ago
  },
  {
    id: "job-finished-cancel",
    type: "slide-generation",
    status: "cancelled",
    progress: 25,
    currentStep: "Cancelado por el usuario",
    courseId: COURSE_B.id,
    updatedAtAgoMs: 45_000, // 45s ago
  },
];

async function seed(db) {
  // Wipe and reseed the test courses so the evidence is stable
  // across runs.
  await db.processingJob.deleteMany({
    where: {
      OR: [
        { courseId: COURSE_A.id },
        { courseId: COURSE_B.id },
      ],
    },
  });
  for (const c of [COURSE_A, COURSE_B]) {
    await db.course.upsert({
      where: { id: c.id },
      update: { name: c.name },
      create: { id: c.id, name: c.name },
    });
  }
  const now = Date.now();
  for (const j of [...ACTIVE_JOBS, ...FINISHED_JOBS]) {
    const updatedAt = new Date(now - j.updatedAtAgoMs);
    // `createdAt` doubles as `startedAt` in the ProcessingJob
    // schema (see listActiveJobsAction — it maps
    // `row.createdAt.getTime()` to the `startedAt` field on
    // ActiveJob). Backdate it so the elapsed time on the row
    // reads sensibly (~30s–2m) rather than the row's age.
    const createdAt = new Date(updatedAt.getTime() - 30_000);
    await db.processingJob.upsert({
      where: { id: j.id },
      update: {
        type: j.type,
        status: j.status,
        progress: j.progress,
        currentStep: j.currentStep,
        courseId: j.courseId,
        updatedAt,
        createdAt,
        error: "error" in j ? j.error ?? null : null,
      },
      create: {
        id: j.id,
        type: j.type,
        status: j.status,
        progress: j.progress,
        currentStep: j.currentStep,
        courseId: j.courseId,
        updatedAt,
        createdAt,
        error: "error" in j ? j.error ?? null : null,
      },
    });
  }
}

async function clear(db) {
  await db.processingJob.deleteMany({
    where: {
      OR: [
        { courseId: COURSE_A.id },
        { courseId: COURSE_B.id },
      ],
    },
  });
  await db.course.deleteMany({
    where: { id: { in: [COURSE_A.id, COURSE_B.id] } },
  });
}

async function captureStable(page, opts = {}) {
  // Pause CSS animations so the screenshot doesn't show
  // mid-transition frames (esp. the slide-in animation on the
  // drawer).
  await page.evaluate(() => {
    document
      .querySelectorAll(
        '[class*="animate-spin"], [class*="animate-pulse"]'
      )
      .forEach((el) => {
        el.style.animation = "none";
      });
  });
  await page.waitForTimeout(opts.settleMs ?? 400);
}

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const db = new PrismaClient();
  let exitCode = 0;
  try {
    await seed(db);
    console.log(
      `  Seeded ${ACTIVE_JOBS.length} active + ${FINISHED_JOBS.length} finished jobs across 2 courses.`
    );

    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => {
      pageErrors.push(e.message);
      console.error("PAGE ERROR:", e.message);
    });

    // =========================================================
    // 1. Nav with the Jobs button + active count badge
    // =========================================================
    console.log("→ 01-nav-button");
    await page.goto(SERVER, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForSelector('[data-testid="nav-jobs"]', {
      timeout: 10_000,
    });
    // Wait for the badge to render (NavJobsButton fetches on
    // mount and the badge appears once activeCount > 0).
    await page.waitForSelector('[data-testid="nav-jobs-badge"]', {
      timeout: 10_000,
    });
    const badgeCount = await page
      .locator('[data-testid="nav-jobs-badge"]')
      .getAttribute("data-count");
    console.log(`  Badge shows ${badgeCount} active jobs.`);
    await captureStable(page);
    // Crop to the header so the badge is the focus.
    const header = page.locator("header").first();
    await header.screenshot({
      path: path.join(EVIDENCE_DIR, "01-nav-button.png"),
      animations: "disabled",
    });
    await writeFile(
      path.join(EVIDENCE_DIR, "01-nav-button.json"),
      JSON.stringify(
        { badgeCount, navItems: ["Inicio", "Trabajos", "Configuración"] },
        null,
        2
      )
    );

    // =========================================================
    // 2. Hover preview
    // =========================================================
    console.log("→ 02-hover-preview");
    // Navigate to a course page so the preview shows the
    // current-course scoped list. Use course A since it has
    // the most active jobs.
    await page.goto(`${SERVER}/courses/${COURSE_A.id}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForSelector('[data-testid="nav-jobs"]', {
      timeout: 10_000,
    });
    // Hover over the nav button. The preview is a child of the
    // same parent div, so it sits directly under the button.
    await page
      .locator('[data-testid="nav-jobs"]')
      .hover({ force: true });
    // Wait for the preview to mount + the data fetch to land.
    await page.waitForSelector('[data-testid="jobs-preview"]', {
      timeout: 10_000,
    });
    // The preview rows render after the fetch resolves —
    // poll for the first row to appear.
    await page
      .locator('[data-testid="jobs-preview-row"]')
      .first()
      .waitFor({ timeout: 10_000 });
    await captureStable(page);
    const preview = page.locator('[data-testid="jobs-preview"]');
    const previewCount = await preview.getAttribute("data-row-count");
    console.log(`  Preview shows ${previewCount} jobs.`);
    // Capture the top-right region of the page so the preview
    // and the nav button are both in frame.
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "02-hover-preview.png"),
      clip: { x: 800, y: 0, width: 640, height: 360 },
      animations: "disabled",
    });
    await writeFile(
      path.join(EVIDENCE_DIR, "02-hover-preview.json"),
      JSON.stringify(
        {
          previewCount,
          courseScope: COURSE_A.name,
          rows: await preview
            .locator('[data-testid="jobs-preview-row"]')
            .evaluateAll((els) =>
              els.map((el) => ({
                jobId: el.getAttribute("data-job-id"),
                type: el.querySelector("p")?.textContent ?? null,
              }))
            ),
        },
        null,
        2
      )
    );

    // Move the mouse away so the preview disappears before
    // the next screenshot.
    await page.mouse.move(100, 100);
    await page.waitForTimeout(200);

    // =========================================================
    // 3. Sidebar — Activos tab
    // =========================================================
    console.log("→ 03-sidebar-active");
    await page.mouse.click(0, 0);
    await page.waitForTimeout(150);
    // Click the nav button to open the drawer.
    await page.locator('[data-testid="nav-jobs"]').click();
    await page.waitForSelector('[data-testid="jobs-sidebar"]', {
      timeout: 10_000,
    });
    // Wait for the rows to render — the rows only appear once
    // the panel's data fetch has resolved, so this is the right
    // synchronization point (the badge attribute may briefly
    // read 0 before the first poll lands).
    await page
      .locator('[data-testid="job-row"][data-tab="active"]')
      .first()
      .waitFor({ timeout: 10_000 });
    // Settle: read the badge AFTER the first fetch has populated
    // the table so the count is in sync with the rendered rows.
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="tab-active-count"]'
        );
        const count = el ? Number(el.getAttribute("data-count")) : 0;
        const rows = document.querySelectorAll(
          '[data-testid="job-row"][data-tab="active"]'
        ).length;
        return count > 0 && count === rows;
      },
      { timeout: 10_000 }
    );
    const activeCount = await page
      .locator('[data-testid="tab-active-count"]')
      .getAttribute("data-count");
    console.log(`  Sidebar Activos tab shows ${activeCount} jobs.`);
    await captureStable(page, { settleMs: 600 });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "03-sidebar-active.png"),
      fullPage: false,
      animations: "disabled",
    });
    await writeFile(
      path.join(EVIDENCE_DIR, "03-sidebar-active.json"),
      JSON.stringify(
        {
          activeCount,
          groups: await page
            .locator('[data-testid="jobs-course-group"]')
            .evaluateAll((els) =>
              els.map((el) => ({
                courseId: el.getAttribute("data-course-id"),
                title: el.querySelector("header span")?.textContent ?? null,
                rowCount: el.querySelectorAll(
                  '[data-testid="job-row"]'
                ).length,
              }))
            ),
        },
        null,
        2
      )
    );

    // =========================================================
    // 4. Sidebar — Finalizados tab
    // =========================================================
    console.log("→ 04-sidebar-finished");
    await page.locator('[data-testid="tab-finished"]').click();
    await page
      .locator('[data-testid="job-row"][data-tab="finished"]')
      .first()
      .waitFor({ timeout: 10_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          '[data-testid="tab-finished-count"]'
        );
        const count = el ? Number(el.getAttribute("data-count")) : 0;
        const rows = document.querySelectorAll(
          '[data-testid="job-row"][data-tab="finished"]'
        ).length;
        return count > 0 && count === rows;
      },
      { timeout: 10_000 }
    );
    const finishedCount = await page
      .locator('[data-testid="tab-finished-count"]')
      .getAttribute("data-count");
    console.log(`  Sidebar Finalizados tab shows ${finishedCount} jobs.`);
    await captureStable(page, { settleMs: 500 });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "04-sidebar-finished.png"),
      fullPage: false,
      animations: "disabled",
    });
    await writeFile(
      path.join(EVIDENCE_DIR, "04-sidebar-finished.json"),
      JSON.stringify(
        {
          finishedCount,
          statuses: await page
            .locator('[data-testid="job-row"]')
            .evaluateAll((els) =>
              els.map((el) => el.getAttribute("data-status"))
            ),
        },
        null,
        2
      )
    );

    // Close the drawer.
    await page.locator('[data-testid="jobs-sidebar-close"]').click();
    await page.waitForTimeout(300);

    // =========================================================
    // 5. /jobs page
    // =========================================================
    console.log("→ 05-jobs-page");
    await page.goto(`${SERVER}/jobs`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForSelector('[data-testid="jobs-panel"]', {
      timeout: 10_000,
    });
    // Wait for the active rows to render.
    await page
      .locator('[data-testid="job-row"]')
      .first()
      .waitFor({ timeout: 10_000 });
    await captureStable(page, { settleMs: 600 });
    await page.screenshot({
      path: path.join(EVIDENCE_DIR, "05-jobs-page.png"),
      fullPage: false,
      animations: "disabled",
    });
    await writeFile(
      path.join(EVIDENCE_DIR, "05-jobs-page.json"),
      JSON.stringify(
        {
          pageUrl: page.url(),
          panelVariant: await page
            .locator('[data-testid="jobs-panel"]')
            .getAttribute("data-variant"),
          activeCount: await page
            .locator('[data-testid="tab-active-count"]')
            .getAttribute("data-count"),
          finishedCount: await page
            .locator('[data-testid="tab-finished-count"]')
            .getAttribute("data-count"),
        },
        null,
        2
      )
    );

    // =========================================================
    // Report
    // =========================================================
    if (pageErrors.length > 0) {
      console.error("FAIL — page errors:");
      for (const e of pageErrors) console.error(`  ${e}`);
      exitCode = 1;
    } else {
      console.log("OK — all evidence captured cleanly.");
    }
    await browser.close();
  } catch (err) {
    console.error("ERROR:", err);
    exitCode = 1;
  } finally {
    try {
      await clear(db);
      console.log("  Cleaned up test data.");
    } catch (e) {
      console.error("Cleanup failed:", e);
    }
    await db.$disconnect();
  }
  process.exit(exitCode);
}

main();

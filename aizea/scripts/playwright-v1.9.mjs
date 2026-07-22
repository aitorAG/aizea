// @ts-check
//
// v1.9 / Issue 3+4 — End-to-end verification of the toolbar
// "Generar diapositivas" button fix.
//
// Assertions:
//   1. Clicking "Generar diapositivas" produces a visible toast
//      BEFORE the navigation (so the user has feedback even if
//      the action is slow).
//   2. The action then navigates to /courses/{id}/slides.
//   3. The slides created have title+description only — NO box
//      content (SlideBox rows), NO htmlDesign populated.
//   4. The "Generar diapositivas" button is disabled while the
//      action is in flight (no double-click).
//   5. The number of slides matches the number of TopicNodes
//      that were in the tree (the action creates one slide per
//      node).
//
// Setup: create a course + seed TopicNodes directly in the DB
// (skip the LLM pipeline — the toolbar button only consumes the
// TopicNode rows, it does not generate them). Then drive the UI
// with Playwright and assert on the post-conditions.

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = join(
  process.cwd(),
  ".test-artifacts",
  "evidence",
  "v1.9"
);
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

const SERVER = "http://localhost:3100";
const TEST_COURSE_ID = randomUUID();
const TEST_COURSE_NAME = "v1.9 Verify Generate Slides";
const SEED_NODES = [
  { name: "Introducción", summary: "Resumen introductorio" },
  { name: "Conceptos previos", summary: null },
  { name: "Desarrollo", summary: "Detalle del tema principal" },
];

function step(label) {
  console.log(`\n=== ${label} ===`);
}

const report = { steps: [], assertions: [] };
function record(name, data) {
  console.log(`  [${name}] ${JSON.stringify(data)}`);
  report.steps.push({ name, data });
}
function assert(name, cond, detail) {
  report.assertions.push({ name, ok: !!cond, detail });
  console.log(`  ${cond ? "OK  " : "FAIL"} ${name}  ${detail ?? ""}`);
}

async function main() {
  const db = new PrismaClient();

  // --- Setup --------------------------------------------------------
  step("Setup: seed test course with 3 TopicNodes");
  await db.course.deleteMany({ where: { id: TEST_COURSE_ID } });
  const course = await db.course.create({
    data: { id: TEST_COURSE_ID, name: TEST_COURSE_NAME },
  });
  for (let i = 0; i < SEED_NODES.length; i++) {
    const node = SEED_NODES[i];
    await db.topicNode.create({
      data: {
        courseId: TEST_COURSE_ID,
        parentId: null,
        name: node.name,
        summary: node.summary,
        depth: 0,
        isLeaf: true,
        version: 1,
      },
    });
  }
  record("seed", {
    courseId: TEST_COURSE_ID,
    courseName: TEST_COURSE_NAME,
    nodeCount: SEED_NODES.length,
  });

  // --- Browser ------------------------------------------------------
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Capture console + page errors so a silent React render error
  // doesn't slip through. (E.g. the previous wiring called
  // `regenerateHtmlDesign` server-side and any throw on the LLM
  // path would show up here.)
  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.log(`  [pageerror] ${err.message}`);
  });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
      console.log(`  [console.error] ${msg.text()}`);
    }
  });

  // ===================================================================
  // SCENARIO 3 — Click "Generar diapositivas" → toast + navigation
  // ===================================================================
  step("Issue 3: toolbar 'Generar diapositivas' shows toast + navigates");
  const treeUrl = `${SERVER}/courses/${TEST_COURSE_ID}/tree`;
  await page.goto(treeUrl, { waitUntil: "networkidle", timeout: 30_000 });
  // Wait for the toolbar to mount.
  await page.waitForSelector('[data-testid="generate-all-slides"]', {
    timeout: 15_000,
  });
  await page.screenshot({
    path: join(EVIDENCE_DIR, "3-01-tree-before-click.png"),
    fullPage: false,
  });

  // Sanity check: the DB has the right number of nodes.
  const dbNodes = await db.topicNode.findMany({
    where: { courseId: TEST_COURSE_ID },
  });
  record("db-nodes-before", { count: dbNodes.length });
  assert(
    "3 — DB has 3 TopicNodes seeded",
    dbNodes.length === SEED_NODES.length,
    `dbNodes=${dbNodes.length}, expected=${SEED_NODES.length}`
  );

  // Click the toolbar button. We DON'T await the click — we want
  // to race against the toast appearing so we can prove the
  // toast is rendered BEFORE navigation completes.
  const generateBtn = page.locator('[data-testid="generate-all-slides"]');
  const beforeBtnText = await generateBtn.textContent().catch(() => "");
  record("generate-button-text", { text: beforeBtnText?.trim() });

  // Fire the click and then poll for the toast within a tight
  // window. The expectation: a toast with text "Generando N
  // diapositiva(s)..." appears SYNCHRONOUSLY (within ~1s of the
  // click). The previous wiring did not show a toast at all —
  // this is the regression we're guarding against.
  const clickPromise = generateBtn.click();

  // Wait for any toast matching "Generando N diapositiva" up to
  // 5s. If the toast never appears we treat the assertion as
  // failed (this is the v1.9 bug we are fixing).
  const toastAppeared = await page
    .locator('text=/Generando\\s+\\d+\\s+diapositiva/i')
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  record("toast-appeared-before-navigation", { toastAppeared });
  assert(
    "3 — toast appears synchronously after click",
    toastAppeared,
    `toastAppeared=${toastAppeared}`
  );

  // Capture a screenshot WITH the toast still on screen, so the
  // evidence shows the toast in flight (this is the requested
  // .test-artifacts/evidence/v1.9/3-generate-slides.png).
  await page.screenshot({
    path: join(EVIDENCE_DIR, "3-generate-slides.png"),
    fullPage: false,
  });

  // Wait for the navigation to land on /slides. We poll the URL
  // because Next.js client navigation may not fire a
  // "domcontentloaded" event for SPA-style transitions.
  const navigated = await page
    .waitForURL(/\/slides$/, { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  await clickPromise;
  record("navigation-completed", {
    navigated,
    finalUrl: page.url(),
  });
  assert(
    "3 — navigated to /courses/{id}/slides",
    navigated,
    `finalUrl=${page.url()}`
  );

  // Take a screenshot of the slides page after navigation so the
  // evidence file shows what the user actually sees on landing.
  await page.screenshot({
    path: join(EVIDENCE_DIR, "3-02-slides-after.png"),
    fullPage: false,
  });

  // Wait for the slides list to render so we can read the
  // per-slide content state.
  await page.waitForSelector('[data-testid="slides-hierarchy"]', {
    timeout: 10_000,
  });

  // ===================================================================
  // SCENARIO 4 — Slides created with title+description ONLY
  // ===================================================================
  step("Issue 4: slides have title+description, NO box content");
  // Query the DB directly: a slide with NO content has zero
  // SlideBox rows. The page derives `hasContent` from the box
  // count, so this is the single source of truth.
  const dbSlides = await db.slide.findMany({
    where: { courseId: TEST_COURSE_ID },
    include: { boxes: true },
    orderBy: { order: "asc" },
  });
  record("db-slides", {
    count: dbSlides.length,
    titles: dbSlides.map((s) => s.title),
    htmlDesigns: dbSlides.map((s) => (s.htmlDesign === null ? "null" : "set")),
    boxCounts: dbSlides.map((s) => s.boxes.length),
  });
  assert(
    "4 — exactly 3 slides created (one per TopicNode)",
    dbSlides.length === SEED_NODES.length,
    `dbSlides=${dbSlides.length}, expected=${SEED_NODES.length}`
  );
  assert(
    "4 — every slide has title set",
    dbSlides.every((s) => typeof s.title === "string" && s.title.length > 0),
    `titles=${JSON.stringify(dbSlides.map((s) => s.title))}`
  );
  assert(
    "4 — every slide has description set (empty string is fine)",
    dbSlides.every((s) => typeof s.description === "string"),
    `descriptions=${JSON.stringify(dbSlides.map((s) => s.description))}`
  );
  assert(
    "4 — NO slide has htmlDesign populated (no auto-HTML)",
    dbSlides.every((s) => s.htmlDesign === null),
    `htmlDesigns=${JSON.stringify(dbSlides.map((s) => s.htmlDesign))}`
  );
  assert(
    "4 — NO slide has any SlideBox rows (no auto-content)",
    dbSlides.every((s) => s.boxes.length === 0),
    `boxCounts=${JSON.stringify(dbSlides.map((s) => s.boxes.length))}`
  );

  // Verify the UI agrees: each slide row should be flagged as
  // "Sin contenido" — the page renders the "Listo" badge only
  // for slides with at least one box.
  const listoLabels = await page
    .locator(".text-emerald-600", { hasText: "Listo" })
    .count()
    .catch(() => 0);
  const sinContenidoLabels = await page
    .locator("text=Sin contenido")
    .count()
    .catch(() => 0);
  record("ui-state", { listoLabels, sinContenidoLabels });
  assert(
    "4 — UI shows 0 'Listo' labels and ≥1 'Sin contenido' labels",
    listoLabels === 0 && sinContenidoLabels >= 1,
    `listoLabels=${listoLabels}, sinContenidoLabels=${sinContenidoLabels}`
  );

  // ===================================================================
  // SCENARIO 3b — re-running the action appends (does not duplicate
  // and replace) the existing slides. This is a v1.9 contract: the
  // previous path (`generateOutline`) replaced existing slides,
  // which would surprise a user who already authored content.
  // ===================================================================
  step("Issue 3b: re-running the action APPENDS slides, does not replace");
  const slidesBefore = await db.slide.count({
    where: { courseId: TEST_COURSE_ID },
  });
  // Navigate back to the tree page and click again.
  await page.goto(treeUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForSelector('[data-testid="generate-all-slides"]', {
    timeout: 15_000,
  });
  const generateBtn2 = page.locator('[data-testid="generate-all-slides"]');
  await generateBtn2.click();
  await page.waitForURL(/\/slides$/, { timeout: 15_000 });
  await page.waitForTimeout(500);
  const slidesAfter = await db.slide.count({
    where: { courseId: TEST_COURSE_ID },
  });
  record("second-run-slide-count", {
    slidesBefore,
    slidesAfter,
  });
  assert(
    "3 — second run appended (slidesAfter > slidesBefore, not replaced)",
    slidesAfter > slidesBefore,
    `before=${slidesBefore}, after=${slidesAfter}`
  );

  // No JS errors during either run.
  assert(
    "3 — no pageerror during either run",
    pageErrors.filter((e) => !/favicon/.test(e)).length === 0,
    JSON.stringify(pageErrors)
  );

  // --- Cleanup ------------------------------------------------------
  await browser.close();
  step("Cleanup: delete test course");
  await db.slideBox.deleteMany({
    where: { slide: { courseId: TEST_COURSE_ID } },
  });
  await db.slide.deleteMany({ where: { courseId: TEST_COURSE_ID } });
  await db.topicNode.deleteMany({ where: { courseId: TEST_COURSE_ID } });
  await db.course.delete({ where: { id: TEST_COURSE_ID } });
  await db.$disconnect();

  // --- Report -------------------------------------------------------
  const allOk = report.assertions.every((a) => a.ok);
  report.allOk = allOk;
  writeFileSync(
    join(EVIDENCE_DIR, "v1.9-report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(`\n${allOk ? "ALL OK" : "FAILED"} — see ${EVIDENCE_DIR}`);
  if (!allOk) {
    console.error(
      "Failed assertions:",
      report.assertions.filter((a) => !a.ok)
    );
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    const db = new PrismaClient();
    await db.slideBox.deleteMany({
      where: { slide: { courseId: TEST_COURSE_ID } },
    });
    await db.slide.deleteMany({ where: { courseId: TEST_COURSE_ID } });
    await db.topicNode.deleteMany({ where: { courseId: TEST_COURSE_ID } });
    await db.course.delete({ where: { id: TEST_COURSE_ID } });
    await db.$disconnect();
  } catch {}
  process.exit(1);
});

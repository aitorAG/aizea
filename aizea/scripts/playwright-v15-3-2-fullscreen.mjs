// @ts-check
//
// v1.5 #2.8 / Task 3.2 — fullscreen mode for the tree view.
//
// Acceptance criteria (from the plan):
//   - Button with fullscreen icon visible in the tree toolbar
//   - Click → page-level header (course name + "Árbol conceptual"
//     title) and CheckpointBar hide
//   - Click again → everything comes back
//   - The tree adjusts to the new space
//
// Strategy:
//   1. Seed a fresh course with a small tree (3-4 TopicNodes) so the
//      screenshot is meaningful.
//   2. Open the tree page; assert the Maximize2 button is present
//      and the CheckpointBar is visible.
//   3. Capture a "before" screenshot showing the full layout (page
//      header, tree, in-page toolbar, CheckpointBar).
//   4. Click the fullscreen button; assert the body data attribute
//      `data-tree-fullscreen="true"` is set, the CheckpointBar is
//      no longer visible (display:none via globals.css), and the
//      page-level header is hidden.
//   5. Capture the "after" screenshot showing the fullscreen layout.
//   6. Click the button again; assert the attribute is removed and
//      the bar + header are back.

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = resolve(
  process.cwd(),
  ".test-artifacts",
  "evidence",
  "v1.5",
  "wave-3"
);
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

const SERVER = "http://localhost:3000";
// Course.id and TopicNode.id are UUIDs in the Prisma schema
// (model Course { id String @id @default(uuid()) }), so the fixture
// has to use real UUIDs. randomUUID() is used for each fresh run so
// the test is idempotent and never collides with stale rows.
const COURSE_ID = randomUUID();
const COURSE_NAME = "v1.5 #3.2 Fullscreen Tree";

function step(label) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
}

const report = { steps: [] };
function record(name, data) {
  // eslint-disable-next-line no-console
  console.log(`  [${name}] ${JSON.stringify(data)}`);
  report.steps.push({ name, data });
}

async function main() {
  const db = new PrismaClient();

  // --- Setup --------------------------------------------------------
  step("Setup: create course with a small 4-node tree");

  // Wipe any prior fixture from previous runs.
  await db.course.deleteMany({ where: { id: COURSE_ID } });
  await db.course.create({
    data: { id: COURSE_ID, name: COURSE_NAME },
  });

  // Root → 2 children → 1 grandchild. Built directly with Prisma so
  // the screenshot has a real tree on screen (not the empty state).
  const root = await db.topicNode.create({
    data: {
      courseId: COURSE_ID,
      parentId: null,
      name: "Capítulo 1 — Introducción",
      summary: "Visión general del curso y motivación.",
      depth: 0,
      isLeaf: false,
      version: 1,
    },
  });
  const childA = await db.topicNode.create({
    data: {
      courseId: COURSE_ID,
      parentId: root.id,
      name: "Tema 1.1 — Conceptos previos",
      summary: "Repaso de los prerrequisitos del curso.",
      depth: 1,
      isLeaf: false,
      version: 1,
    },
  });
  const childB = await db.topicNode.create({
    data: {
      courseId: COURSE_ID,
      parentId: root.id,
      name: "Tema 1.2 — Primeros ejemplos",
      summary: "Ejemplos guiados para arrancar.",
      depth: 1,
      isLeaf: false,
      version: 1,
    },
  });
  await db.topicNode.create({
    data: {
      courseId: COURSE_ID,
      parentId: childA.id,
      name: "Subtema 1.1.1 — Definiciones",
      summary: null,
      depth: 2,
      isLeaf: true,
      version: 1,
    },
  });
  record("seed", { courseId: COURSE_ID, root: root.id, childA: childA.id, childB: childB.id });

  // --- Browser ------------------------------------------------------
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const url = `${SERVER}/courses/${COURSE_ID}/tree`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  // Wait for the tree to actually render (nodes are async via dagre).
  await page.waitForSelector('[data-testid="tree-controls"]', { timeout: 15_000 });
  await page.waitForSelector('.react-flow__node', { timeout: 15_000 });
  // Give the dagre layout one more frame to settle.
  await page.waitForTimeout(700);

  // --- 1. Initial state ---------------------------------------------
  step("Initial state — page header visible, CheckpointBar visible");
  const initialBodyAttr = await page.evaluate(() => document.body.getAttribute("data-tree-fullscreen"));
  const initialBarVisible = await page
    .locator('[data-testid="checkpoint-bar"]')
    .isVisible();
  const initialButtonPressed = await page
    .locator('[data-testid="toggle-fullscreen"]')
    .getAttribute("aria-pressed");
  const initialButtonLabel = await page
    .locator('[data-testid="toggle-fullscreen"]')
    .getAttribute("aria-label");
  record("initial", {
    bodyAttr: initialBodyAttr,
    checkpointBarVisible: initialBarVisible,
    buttonAriaPressed: initialButtonPressed,
    buttonAriaLabel: initialButtonLabel,
  });

  await page.screenshot({
    path: join(EVIDENCE_DIR, "3.2-fullscreen-before.png"),
    fullPage: false,
  });

  // --- 2. Click the fullscreen button -------------------------------
  step("Click fullscreen → page header + CheckpointBar hide");
  await page.locator('[data-testid="toggle-fullscreen"]').click();
  await page.waitForTimeout(500);

  const afterBodyAttr = await page.evaluate(() => document.body.getAttribute("data-tree-fullscreen"));
  const afterBarVisible = await page
    .locator('[data-testid="checkpoint-bar"]')
    .isVisible();
  const afterButtonPressed = await page
    .locator('[data-testid="toggle-fullscreen"]')
    .getAttribute("aria-pressed");
  const afterButtonLabel = await page
    .locator('[data-testid="toggle-fullscreen"]')
    .getAttribute("aria-label");
  // The page header is the h1 with "Árbol conceptual". It should
  // NOT be visible in fullscreen. (We hid the wrapping div with
  // the .hidden class so the h1 is detached from layout.)
  const headerHidden = await page
    .locator("h1", { hasText: "Árbol conceptual" })
    .isVisible();
  // The in-page toolbar (TreeControls) MUST still be visible in
  // fullscreen — the user explicitly asked for the
  // "barra superior de herramientas" to remain.
  const toolbarStillVisible = await page
    .locator('[data-testid="tree-controls"]')
    .isVisible();
  record("after-click", {
    bodyAttr: afterBodyAttr,
    checkpointBarVisible: afterBarVisible,
    pageHeaderVisible: headerHidden,
    toolbarStillVisible,
    buttonAriaPressed: afterButtonPressed,
    buttonAriaLabel: afterButtonLabel,
  });

  await page.screenshot({
    path: join(EVIDENCE_DIR, "3.2-fullscreen.png"),
    fullPage: false,
  });

  // --- 3. Click again to exit ---------------------------------------
  step("Click again → everything comes back");
  await page.locator('[data-testid="toggle-fullscreen"]').click();
  await page.waitForTimeout(500);

  const exitBodyAttr = await page.evaluate(() => document.body.getAttribute("data-tree-fullscreen"));
  const exitBarVisible = await page
    .locator('[data-testid="checkpoint-bar"]')
    .isVisible();
  const exitHeaderVisible = await page
    .locator("h1", { hasText: "Árbol conceptual" })
    .isVisible();
  const exitButtonPressed = await page
    .locator('[data-testid="toggle-fullscreen"]')
    .getAttribute("aria-pressed");
  record("after-exit", {
    bodyAttr: exitBodyAttr,
    checkpointBarVisible: exitBarVisible,
    pageHeaderVisible: exitHeaderVisible,
    buttonAriaPressed: exitButtonPressed,
  });

  await page.screenshot({
    path: join(EVIDENCE_DIR, "3.2-fullscreen-exit.png"),
    fullPage: false,
  });

  await browser.close();

  // --- Assertions ---------------------------------------------------
  step("Assertions");
  const checks = [];
  function assert(name, cond, detail) {
    checks.push({ name, ok: !!cond, detail });
    console.log(`  ${cond ? "OK " : "FAIL"}  ${name}  ${detail ?? ""}`);
  }
  assert(
    "initial: body has no data-tree-fullscreen",
    initialBodyAttr === null,
    initialBodyAttr
  );
  assert(
    "initial: CheckpointBar visible",
    initialBarVisible === true
  );
  assert(
    "initial: button aria-pressed=false",
    initialButtonPressed === "false",
    initialButtonPressed
  );

  assert(
    "click: body has data-tree-fullscreen=true",
    afterBodyAttr === "true",
    afterBodyAttr
  );
  assert(
    "click: CheckpointBar hidden (display:none)",
    afterBarVisible === false
  );
  assert(
    "click: page header (h1) hidden",
    headerHidden === false
  );
  assert(
    "click: in-page toolbar (TreeControls) STILL visible",
    toolbarStillVisible === true
  );
  assert(
    "click: button aria-pressed=true",
    afterButtonPressed === "true",
    afterButtonPressed
  );
  assert(
    "click: button label flipped to exit text",
    /Salir|minimizar|exit/i.test(afterButtonLabel ?? ""),
    afterButtonLabel
  );

  assert(
    "exit: body attribute removed",
    exitBodyAttr === null,
    exitBodyAttr
  );
  assert(
    "exit: CheckpointBar visible again",
    exitBarVisible === true
  );
  assert(
    "exit: page header visible again",
    exitHeaderVisible === true
  );
  assert(
    "exit: button aria-pressed=false",
    exitButtonPressed === "false",
    exitButtonPressed
  );

  const allOk = checks.every((c) => c.ok);
  report.assertions = checks;
  report.allOk = allOk;
  writeFileSync(
    join(EVIDENCE_DIR, "3.2-fullscreen-report.json"),
    JSON.stringify(report, null, 2)
  );

  if (!allOk) {
    console.error("\nFAILED assertions:", checks.filter((c) => !c.ok));
    process.exit(1);
  }
  console.log("\nAll assertions passed.");

  // --- Cleanup ------------------------------------------------------
  step("Cleanup: delete fixture course");
  await db.course.deleteMany({ where: { id: COURSE_ID } });
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    const db = new PrismaClient();
    await db.course.deleteMany({ where: { id: COURSE_ID } });
    await db.$disconnect();
  } catch {}
  process.exit(1);
});

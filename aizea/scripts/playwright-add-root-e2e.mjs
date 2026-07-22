// @ts-check
//
// Playwright E2E for the "Añadir raíz" toolbar button — the user
// reports "clicking Añadir raíz doesn't add a node to the tree".
//
// Test plan (mirrors the user's brief):
//   1. Visit /courses/{id}/tree on a course with 0 nodes.
//   2. Try to find the "Añadir raíz" button and click it.
//   3. Check if a new node appears in the tree.
//   4. Check the server action's response (via DB inspection).
//   5. Take screenshots: BEFORE click, AFTER click, after 2s wait.
//
// Then we run the SAME test on a course with at least one node —
// because the toolbar's "Añadir raíz" button is only rendered when
// the TreeViewer is mounted, and the TreeViewer is only mounted
// when the tree is non-empty (see `tree-client.tsx` lines 451-505).
// We document what we find either way.

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = join(process.cwd(), ".test-artifacts", "evidence", "add-root-fix");
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

const SERVER = "http://localhost:3000";

// --- Test fixtures ------------------------------------------------------

// Course with 0 nodes — for the "as described" test.
const ZERO_NODES_COURSE_ID = "cefd1597-5eeb-4e1c-80f4-27a50e8bfd80";

// Course with > 0 nodes — for the secondary test (the button lives in
// the TreeViewer's toolbar, which is only mounted when the tree is
// non-empty).
const POPULATED_COURSE_ID = "eb18c671-5184-4461-b01e-c0cf800cccb6";

const results = {
  zeroNodes: {},
  populated: {},
};

function logHeader(label) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
}

// --- DB helpers ---------------------------------------------------------

async function countNodes(db, courseId) {
  return db.topicNode.count({ where: { courseId } });
}

async function listNodes(db, courseId) {
  return db.topicNode.findMany({
    where: { courseId },
    orderBy: [{ depth: "asc" }, { createdAt: "asc" }],
  });
}

// --- Test 1: 0-nodes course ---------------------------------------------

async function testZeroNodes(page, db) {
  logHeader("TEST 1: 0-nodes course");

  const before = await countNodes(db, ZERO_NODES_COURSE_ID);
  console.log(`  TopicNodes before: ${before}`);

  const url = `${SERVER}/courses/${ZERO_NODES_COURSE_ID}/tree`;
  console.log(`  Navigating to ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "01-zero-nodes-before-click.png"),
    fullPage: true,
  });

  // The toolbar "Añadir raíz" button is rendered inside the TreeViewer's
  // toolbar, which only mounts when there are nodes. On a 0-nodes
  // course the page renders its own empty state with a "Generar árbol"
  // button instead.
  const emptyState = page.locator('[data-testid="empty-tree"]');
  const emptyVisible = await emptyState.isVisible().catch(() => false);
  console.log(`  empty-tree visible: ${emptyVisible}`);

  const addRootBtn = page.locator('button[aria-label="Añadir raíz"]');
  const addRootCount = await addRootBtn.count();
  console.log(`  'Añadir raíz' button count: ${addRootCount}`);

  let clickResult = "not_clicked";
  if (addRootCount > 0) {
    await addRootBtn.first().click();
    clickResult = "clicked";
    await page.waitForTimeout(2_000);
  } else {
    // The button doesn't exist in the empty state. As a separate
    // check: is there a "Generar árbol" button (the page-level
    // alternative)?
    const generarArbolBtn = page.locator('button', { hasText: "Generar árbol" });
    const generarCount = await generarArbolBtn.count();
    console.log(`  'Generar árbol' button count (alternative): ${generarCount}`);
    clickResult = "button_missing";
  }
  await page.screenshot({
    path: join(EVIDENCE_DIR, "02-zero-nodes-after-2s.png"),
    fullPage: true,
  });

  const after = await countNodes(db, ZERO_NODES_COURSE_ID);
  console.log(`  TopicNodes after: ${after}`);
  const createdDelta = after - before;
  console.log(`  delta: ${createdDelta}`);

  results.zeroNodes = {
    courseId: ZERO_NODES_COURSE_ID,
    before,
    after,
    delta: createdDelta,
    addRootButtonCount: addRootCount,
    emptyStateVisible: emptyVisible,
    clickResult,
  };
}

// --- Test 2: populated course -------------------------------------------

async function testPopulated(page, db) {
  logHeader("TEST 2: 1+ nodes course");

  const before = await countNodes(db, POPULATED_COURSE_ID);
  console.log(`  TopicNodes before: ${before}`);

  const url = `${SERVER}/courses/${POPULATED_COURSE_ID}/tree`;
  console.log(`  Navigating to ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "03-populated-before-click.png"),
    fullPage: true,
  });

  const addRootBtn = page.locator('button[aria-label="Añadir raíz"]');
  const addRootCount = await addRootBtn.count();
  console.log(`  'Añadir raíz' button count: ${addRootCount}`);

  if (addRootCount === 0) {
    console.log("  !! 'Añadir raíz' button is NOT in the DOM.");
    results.populated = {
      courseId: POPULATED_COURSE_ID,
      addRootButtonCount: 0,
      note: "button_not_found",
    };
    return;
  }

  await addRootBtn.first().click();
  console.log("  Clicked 'Añadir raíz'");
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "04-populated-just-after-click.png"),
    fullPage: true,
  });

  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "05-populated-after-2s.png"),
    fullPage: true,
  });

  // Now look for the inline-edit form. The TreeNode should mount an
  // InlineTreeNodeEditor (data-testid="inline-tree-node-editor") on
  // the freshly-added node.
  const inlineEditors = page.locator('[data-testid="inline-tree-node-editor"]');
  const editorCount = await inlineEditors.count();
  console.log(`  inline-tree-node-editor count: ${editorCount}`);

  // Look for "Nuevo nodo" placeholder text in any input.
  const nameInputs = await page
    .locator('input[data-testid="inline-tree-node-name-input"]')
    .count();
  console.log(`  inline name input count: ${nameInputs}`);

  // Check the DB for the new node.
  await page.waitForTimeout(2_000);
  const after = await countNodes(db, POPULATED_COURSE_ID);
  const nodesList = await listNodes(db, POPULATED_COURSE_ID);
  const newest = nodesList[nodesList.length - 1];
  console.log(`  TopicNodes after: ${after}  delta: ${after - before}`);
  if (newest) {
    console.log(
      `  newest node: id=${newest.id} name="${newest.name}" parentId=${newest.parentId} depth=${newest.depth} courseId=${newest.courseId}`
    );
  }

  results.populated = {
    courseId: POPULATED_COURSE_ID,
    before,
    after,
    delta: after - before,
    addRootButtonCount: addRootCount,
    inlineEditorCount: editorCount,
    inlineNameInputCount: nameInputs,
    newestNode: newest
      ? {
          id: newest.id,
          name: newest.name,
          parentId: newest.parentId,
          depth: newest.depth,
          courseId: newest.courseId,
        }
      : null,
  };
}

// --- main ---------------------------------------------------------------

async function main() {
  const db = new PrismaClient();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`  [browser console error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    console.log(`  [browser pageerror] ${err.message}`);
  });

  try {
    await testZeroNodes(page, db);
  } catch (e) {
    console.log("  TEST 1 threw:", e.message);
    results.zeroNodes = { error: e.message };
  }

  try {
    await testPopulated(page, db);
  } catch (e) {
    console.log("  TEST 2 threw:", e.message);
    results.populated = { error: e.message };
  }

  await browser.close();
  await db.$disconnect();

  writeFileSync(
    join(EVIDENCE_DIR, "results.json"),
    JSON.stringify(results, null, 2),
    "utf8"
  );
  console.log("\nFINAL RESULTS:");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("Playwright E2E failed:", err);
  process.exit(1);
});

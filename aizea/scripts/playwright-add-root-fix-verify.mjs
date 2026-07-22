// @ts-check
//
// Playwright E2E for the "Añadir raíz" empty-state button.
//
// Verifies the fix: the empty state now exposes an "Añadir raíz"
// button so the user can bootstrap a tree on a course with 0 nodes
// (previously, the only available action was "Generar árbol", which
// runs the LLM pipeline and produces nothing on a course with no
// materials).

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = join(process.cwd(), ".test-artifacts", "evidence", "add-root-fix");
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

const SERVER = "http://localhost:3000";

const ZERO_NODES_COURSE_ID = "cefd1597-5eeb-4e1c-80f4-27a50e8bfd80";
const POPULATED_COURSE_ID = "eb18c671-5184-4461-b01e-c0cf800cccb6";

const results = { zeroNodes: {}, populated: {} };

function logHeader(label) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
}

async function countNodes(db, courseId) {
  return db.topicNode.count({ where: { courseId } });
}

async function listNewestRoots(db, courseId) {
  return db.topicNode.findMany({
    where: { courseId, parentId: null },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
}

async function cleanupTestNodes(db, courseId, namePattern) {
  const result = await db.topicNode.deleteMany({
    where: { courseId, name: { contains: namePattern } },
  });
  if (result.count > 0) {
    console.log(`  cleaned up ${result.count} test row(s) matching "${namePattern}"`);
  }
}

async function testZeroNodes(page, db) {
  logHeader("TEST 1 (after fix): 0-nodes course — click 'Añadir raíz' from the empty state");

  const before = await countNodes(db, ZERO_NODES_COURSE_ID);
  console.log(`  TopicNodes before: ${before}`);

  const url = `${SERVER}/courses/${ZERO_NODES_COURSE_ID}/tree`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "10-fix-zero-nodes-before.png"),
    fullPage: true,
  });

  // The fix added a new button: data-testid="empty-state-add-root"
  const addRootBtn = page.locator('[data-testid="empty-state-add-root"]');
  const addRootCount = await addRootBtn.count();
  console.log(`  'empty-state-add-root' button count: ${addRootCount}`);

  if (addRootCount === 0) {
    console.log("  !! Fix did NOT render the empty-state 'Añadir raíz' button");
    await page.screenshot({
      path: join(EVIDENCE_DIR, "11-fix-zero-nodes-MISSING.png"),
      fullPage: true,
    });
    results.zeroNodes = { fixApplied: false, addRootButtonCount: 0 };
    return;
  }

  await addRootBtn.first().click();
  console.log("  Clicked 'Añadir raíz' on the empty state");
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "11-fix-zero-nodes-just-after-click.png"),
    fullPage: true,
  });
  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "12-fix-zero-nodes-after-2s.png"),
    fullPage: true,
  });

  // The TreeViewer should now have mounted (hasTree flipped to true).
  // Look for the inline editor on the new node + the toolbar.
  const inlineEditors = page.locator('[data-testid="inline-tree-node-editor"]');
  const editorCount = await inlineEditors.count();
  console.log(`  inline-tree-node-editor count: ${editorCount}`);

  const treeControls = page.locator('[data-testid="tree-controls"]');
  const treeControlsCount = await treeControls.count();
  console.log(`  tree-controls count: ${treeControlsCount}`);

  const after = await countNodes(db, ZERO_NODES_COURSE_ID);
  console.log(`  TopicNodes after: ${after}  delta: ${after - before}`);

  const newRoots = await listNewestRoots(db, ZERO_NODES_COURSE_ID);
  console.log(`  newest roots:`);
  for (const r of newRoots) {
    console.log(
      `    ${r.id}  name="${r.name}"  depth=${r.depth}  createdAt=${r.createdAt.toISOString()}`
    );
  }

  results.zeroNodes = {
    fixApplied: true,
    courseId: ZERO_NODES_COURSE_ID,
    before,
    after,
    delta: after - before,
    addRootButtonCount: addRootCount,
    inlineEditorCount: editorCount,
    treeControlsCount: treeControlsCount,
    newestRoot: newRoots[0]
      ? {
          id: newRoots[0].id,
          name: newRoots[0].name,
          depth: newRoots[0].depth,
          createdAt: newRoots[0].createdAt.toISOString(),
        }
      : null,
  };
}

async function testPopulated(page, db) {
  logHeader("TEST 2 (regression): 1+ nodes course — toolbar 'Añadir raíz' still works");

  const before = await countNodes(db, POPULATED_COURSE_ID);
  console.log(`  TopicNodes before: ${before}`);

  const url = `${SERVER}/courses/${POPULATED_COURSE_ID}/tree`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "13-fix-populated-before.png"),
    fullPage: true,
  });

  const addRootBtn = page.locator('button[aria-label="Añadir raíz"]').first();
  await addRootBtn.click();
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "14-fix-populated-after-click.png"),
    fullPage: true,
  });
  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "15-fix-populated-after-2s.png"),
    fullPage: true,
  });

  const inlineEditors = page.locator('[data-testid="inline-tree-node-editor"]');
  const editorCount = await inlineEditors.count();
  const after = await countNodes(db, POPULATED_COURSE_ID);
  console.log(`  TopicNodes after: ${after}  delta: ${after - before}`);
  console.log(`  inline-tree-node-editor count: ${editorCount}`);

  results.populated = {
    courseId: POPULATED_COURSE_ID,
    before,
    after,
    delta: after - before,
    inlineEditorCount: editorCount,
  };
}

async function main() {
  const db = new PrismaClient();

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => {
    console.log(`  [browser pageerror] ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`  [browser console error] ${msg.text()}`);
    }
  });

  // Clean up any leftover test rows first.
  console.log("=== Cleanup before test ===");
  await cleanupTestNodes(db, ZERO_NODES_COURSE_ID, "Nuevo nodo");
  await cleanupTestNodes(db, POPULATED_COURSE_ID, "Nuevo nodo");

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

  // Final cleanup
  console.log("\n=== Cleanup after test ===");
  await cleanupTestNodes(db, ZERO_NODES_COURSE_ID, "Nuevo nodo");
  await cleanupTestNodes(db, POPULATED_COURSE_ID, "Nuevo nodo");

  await browser.close();
  await db.$disconnect();

  writeFileSync(
    join(EVIDENCE_DIR, "results-after-fix.json"),
    JSON.stringify(results, null, 2),
    "utf8"
  );
  console.log("\nFINAL RESULTS (after fix):");
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error("Playwright E2E failed:", err);
  process.exit(1);
});

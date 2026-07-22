// @ts-check
//
// Clean "before" + "after" screenshots of the 0-nodes empty state.
// The previous captures got covered by concurrent pipeline banners, so
// we run a small targeted capture that just shows the empty state with
// the new "Añadir raíz" button (before click) and the resulting
// TreeViewer + inline editor (after click).

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = join(process.cwd(), ".test-artifacts", "evidence", "add-root-fix");
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

const SERVER = "http://localhost:3000";
const ZERO_NODES_COURSE_ID = "cefd1597-5eeb-4e1c-80f4-27a50e8bfd80";

async function main() {
  const db = new PrismaClient();

  // Make sure the course has 0 nodes.
  const before = await db.topicNode.count({
    where: { courseId: ZERO_NODES_COURSE_ID },
  });
  if (before !== 0) {
    console.log(`Course has ${before} nodes — cleanup needed.`);
    await db.topicNode.deleteMany({ where: { courseId: ZERO_NODES_COURSE_ID } });
  }
  console.log(`Course has 0 nodes (verified).`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  const url = `${SERVER}/courses/${ZERO_NODES_COURSE_ID}/tree`;
  console.log(`Navigating to ${url}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(2_000);

  // Dismiss the global banner stack so the empty state is unobstructed.
  // The banner has a [data-testid="banner-close"] close button (see
  // scripts/playwright-banner-e2e.mjs). We click them all.
  for (let i = 0; i < 10; i++) {
    const closeBtns = page.locator('[data-testid="banner-close"]');
    const c = await closeBtns.count();
    if (c === 0) break;
    await closeBtns.first().click();
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(500);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "20-clean-empty-state-with-new-button.png"),
    fullPage: true,
  });
  console.log("Captured: 20-clean-empty-state-with-new-button.png");

  // Now click the new "Añadir raíz" button on the empty state.
  const addRootBtn = page.locator('[data-testid="empty-state-add-root"]');
  const c = await addRootBtn.count();
  console.log(`empty-state-add-root button count: ${c}`);
  await addRootBtn.first().click();
  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "21-clean-after-click-tree-mounted.png"),
    fullPage: true,
  });
  console.log("Captured: 21-clean-after-click-tree-mounted.png");

  // Verify the new node landed in the DB as a root.
  const after = await db.topicNode.findMany({
    where: { courseId: ZERO_NODES_COURSE_ID },
    orderBy: { createdAt: "desc" },
  });
  console.log(`DB rows after click: ${after.length}`);
  if (after[0]) {
    console.log(
      `  newest: id=${after[0].id}  name="${after[0].name}"  parentId=${after[0].parentId}  depth=${after[0].depth}`
    );
  }

  // Clean up.
  await db.topicNode.deleteMany({ where: { courseId: ZERO_NODES_COURSE_ID } });
  console.log("Cleaned up test row(s).");

  await browser.close();
  await db.$disconnect();
}

main().catch((err) => {
  console.error("Capture failed:", err);
  process.exit(1);
});

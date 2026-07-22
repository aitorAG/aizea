// v1.5 / Batch 3 — capture screenshots for the 3 fixes:
//   2.7 — Edit button in tree toolbar
//   2.8 — Fullscreen toggle hides header + CheckpointBar
//   3.1 — Slides hierarchy with depth-based indentation
//
// Uses the existing "fisica test 3 pags" course that has both a
// tree (11 nodes across 3 depths) and now slides (created by
// scripts/seed-slides-from-tree.mjs).

import { chromium } from "playwright";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const EVIDENCE_DIR = resolve(process.cwd(), ".test-artifacts", "evidence", "v1.5", "batch3");
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

const SERVER = "http://localhost:3000";
const COURSE_ID = "ff340bd3-a4d6-457d-95a4-44845989f27d";
const TREE_URL = `${SERVER}/courses/${COURSE_ID}/tree`;
const SLIDES_URL = `${SERVER}/courses/${COURSE_ID}/slides`;

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
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  // ──────────────────── 2.7 Edit button ────────────────────
  step("2.7 — Edit button in tree toolbar");
  await page.goto(TREE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  // The button is disabled when nothing is selected.
  const editBtn = page.getByRole("button", { name: "Editar nodo seleccionado" });
  await editBtn.waitFor({ state: "visible" });
  const editDisabled = await editBtn.isDisabled();
  record("2.7.edit-button-visible-and-disabled-when-no-selection", {
    visible: await editBtn.isVisible(),
    disabled: editDisabled,
  });

  // Take a screenshot showing the toolbar with the Edit button
  // (disabled, since nothing is selected).
  await page.screenshot({
    path: resolve(EVIDENCE_DIR, "2.7-edit.png"),
    fullPage: false,
  });

  // Now select a node so the Edit button enables. We click on
  // a node in the ReactFlow canvas.
  // The nodes have role="button" via the TreeNode component.
  const nodes = page.locator(".react-flow__node");
  const nodeCount = await nodes.count();
  record("2.7.node-count-in-canvas", { count: nodeCount });

  if (nodeCount > 0) {
    await nodes.first().click();
    await page.waitForTimeout(400);
    const editEnabledAfter = await editBtn.isEnabled();
    record("2.7.edit-enabled-after-selecting-one-node", {
      enabled: editEnabledAfter,
    });
    await page.screenshot({
      path: resolve(EVIDENCE_DIR, "2.7-edit-enabled.png"),
      fullPage: false,
    });
  }

  // ──────────────────── 2.8 Fullscreen ────────────────────
  step("2.8 — Fullscreen toggle");
  // First, deselect (click empty area) to reset selection.
  await page.mouse.click(640, 700);
  await page.waitForTimeout(300);

  // Capture "before fullscreen" - the header + CheckpointBar visible.
  const fsBtn = page.locator('[data-testid="toggle-fullscreen"]');
  await fsBtn.waitFor({ state: "visible" });
  const beforeHeaderVisible = await page.locator("header").isVisible().catch(() => false);
  const beforeCpVisible = await page
    .locator('[data-testid="checkpoint-bar"]')
    .isVisible()
    .catch(() => false);
  const beforeAttr = await page.evaluate(() => document.body.dataset.treeFullscreen);
  record("2.8.before-fullscreen", {
    headerVisible: beforeHeaderVisible,
    checkpointBarVisible: beforeCpVisible,
    bodyAttr: beforeAttr,
  });

  await page.screenshot({
    path: resolve(EVIDENCE_DIR, "2.8-fullscreen-before.png"),
    fullPage: false,
  });

  // Click the fullscreen toggle
  await fsBtn.click();
  await page.waitForTimeout(500);
  const afterHeaderVisible = await page
    .locator("header")
    .isVisible()
    .catch(() => false);
  const afterCpVisible = await page
    .locator('[data-testid="checkpoint-bar"]')
    .isVisible()
    .catch(() => false);
  const afterAttr = await page.evaluate(() => document.body.dataset.treeFullscreen);
  record("2.8.after-fullscreen-on", {
    headerVisible: afterHeaderVisible,
    checkpointBarVisible: afterCpVisible,
    bodyAttr: afterAttr,
  });

  // Take the "after fullscreen" screenshot (the canonical 2.8 shot).
  await page.screenshot({
    path: resolve(EVIDENCE_DIR, "2.8-fullscreen.png"),
    fullPage: false,
  });

  // Toggle back
  await fsBtn.click();
  await page.waitForTimeout(400);
  const restoredAttr = await page.evaluate(() => document.body.dataset.treeFullscreen);
  record("2.8.after-fullscreen-off", { bodyAttr: restoredAttr });

  // ──────────────────── 3.1 Slides hierarchy ────────────────────
  step("3.1 — Slides hierarchy");
  await page.goto(SLIDES_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);

  // Verify that some slides have a depth > 0 and the
  // .slide-hierarchy elements are present.
  const hierarchyInfo = await page.evaluate(() => {
    const all = document.querySelectorAll(".slide-hierarchy");
    const depths = new Set();
    let nonZero = 0;
    for (const el of all) {
      const d = el.getAttribute("data-depth");
      depths.add(d);
      if (d !== "0") nonZero++;
    }
    return { total: all.length, depths: [...depths], nonZeroDepth: nonZero };
  });
  record("3.1.slide-hierarchy-elements", hierarchyInfo);

  // The leftmost title text of each slide row to verify the
  // hierarchy visually in the screenshot.
  const slideTitles = await page.evaluate(() => {
    const titles = [];
    document.querySelectorAll(".slide-hierarchy h3").forEach((h) => {
      const row = h.closest(".slide-hierarchy");
      const depth = row?.getAttribute("data-depth") ?? "?";
      titles.push({ depth, title: h.textContent?.trim() ?? "" });
    });
    return titles;
  });
  record("3.1.slide-titles-with-depth", slideTitles);

  await page.screenshot({
    path: resolve(EVIDENCE_DIR, "3.1-hierarchy.png"),
    fullPage: true,
  });

  await browser.close();

  // Persist a JSON report
  writeFileSync(
    resolve(EVIDENCE_DIR, "report.json"),
    JSON.stringify(report, null, 2)
  );
  // eslint-disable-next-line no-console
  console.log(`\nReport written. ${report.steps.length} steps recorded.`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

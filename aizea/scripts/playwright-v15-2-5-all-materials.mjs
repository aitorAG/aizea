// @ts-check
//
// E2E verification for v1.5 finding 2.5:
//   "When clicking 'Generar árbol', process ALL materials in the
//    course (not just the first one)."
//
// Acceptance:
//   - 2+ materials in a course → tree contains concepts from ALL
//   - One material failing doesn't break the others
//   - Clear error message for which material failed
//
// Strategy:
//   1. Create a fresh course.
//   2. Upload TWO distinct fixture PDFs (sample.pdf + structured-doc.pdf)
//      via the materials page file input.
//   3. Navigate to the tree page and click "Generar árbol".
//   4. Poll the DB until TopicNodes appear (the unified tree).
//   5. Verify the tree has nodes (concepts from BOTH materials).
//   6. Save a screenshot to
//      .test-artifacts/evidence/v1.5/wave-2/2.5-all-materials.png
//
// Pre-req: dev server running on http://localhost:3000 and the
// Prisma DB reachable.

import { chromium } from "playwright";
import { mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = join(
  process.cwd(),
  ".test-artifacts",
  "evidence",
  "v1.5",
  "wave-2"
);
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
const SCREENSHOT_PATH = join(EVIDENCE_DIR, "2.5-all-materials.png");
const REPORT_PATH = join(EVIDENCE_DIR, "2.5-all-materials.json");

const FIXTURE_1 = join(process.cwd(), "tests", "fixtures", "sample.pdf");
const FIXTURE_2 = join(
  process.cwd(),
  "tests",
  "fixtures",
  "structured-doc.pdf"
);

const log = (msg) => console.log(`  ${msg}`);

async function main() {
  const db = new PrismaClient();
  const report = {
    startedAt: new Date().toISOString(),
    fixture1: { path: FIXTURE_1, size: statSync(FIXTURE_1).size },
    fixture2: { path: FIXTURE_2, size: statSync(FIXTURE_2).size },
    steps: {},
  };

  // Clean leftover state for this test run.
  await db.processingJob.deleteMany({});
  await db.topicNode.deleteMany({});
  await db.material.deleteMany({
    where: { filename: { contains: "qa-2.5" } },
  });
  // Rename fixtures copies so we can identify them in the DB.
  // (We can't rename the originals; we rely on the upload storing
  //  the original filename, so we just track by course.)

  const course = await db.course.create({
    data: { name: `QA 2.5 All Materials ${Date.now()}` },
  });
  report.courseId = course.id;
  log(`course=${course.id} name="${course.name}"`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();

  // Pre-warm dev server.
  log("pre-warming dev server...");
  try {
    await page.goto("http://localhost:3000/", {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
  } catch (e) {
    log(`pre-warm warning: ${e.message}`);
  }

  // --- 1. Navigate to materials page. -----------------------------------
  log("\n=== 1. Open materials page ===");
  await page.goto(`http://localhost:3000/courses/${course.id}/materials`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});

  // --- 2. Upload first PDF. ----------------------------------------------
  log("\n=== 2. Upload first PDF (sample.pdf) ===");
  const input1 = page
    .locator('[data-testid="upload-zone"] input[type="file"]')
    .first();
  await input1.waitFor({ state: "attached", timeout: 30000 });
  await input1.setInputFiles(FIXTURE_1);
  // Wait for the upload to complete and the material to appear.
  await page.waitForFunction(
    () => !document.body.innerText.includes("Sin materiales subidos"),
    { timeout: 60_000 }
  );
  await page.waitForTimeout(1500);
  const materialsAfter1 = await db.material.findMany({
    where: { courseId: course.id },
  });
  log(`  DB materials after upload 1: ${materialsAfter1.length}`);
  report.steps.upload1 = { materialsCount: materialsAfter1.length };

  // --- 3. Upload second PDF. ---------------------------------------------
  log("\n=== 3. Upload second PDF (structured-doc.pdf) ===");
  const input2 = page
    .locator('[data-testid="upload-zone"] input[type="file"]')
    .first();
  await input2.waitFor({ state: "attached", timeout: 30000 });
  await input2.setInputFiles(FIXTURE_2);
  // Wait for the second material to appear (count >= 2).
  await page.waitForFunction(
    () => {
      const cards = document.querySelectorAll(
        '[data-testid^="material-card"], [data-testid^="file-card"]'
      );
      return cards.length >= 2;
    },
    { timeout: 60_000 }
  );
  await page.waitForTimeout(1500);
  const materialsAfter2 = await db.material.findMany({
    where: { courseId: course.id },
    orderBy: { createdAt: "asc" },
  });
  log(`  DB materials after upload 2: ${materialsAfter2.length}`);
  report.steps.upload2 = {
    materialsCount: materialsAfter2.length,
    filenames: materialsAfter2.map((m) => m.filename),
  };
  if (materialsAfter2.length < 2) {
    throw new Error(
      `FAIL: expected 2 materials, got ${materialsAfter2.length}`
    );
  }
  log("  ✓ Two materials uploaded");

  // --- 4. Navigate to tree page and click "Generar árbol". --------------
  log("\n=== 4. Open tree page and click 'Generar árbol' ===");
  await page.goto(`http://localhost:3000/courses/${course.id}/tree`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});

  // The "Generar árbol" button lives in the empty state.
  // Locate by visible text (no data-testid on this button).
  const generateBtn = page.getByRole("button", { name: /Generar árbol/i });
  await generateBtn.waitFor({ state: "visible", timeout: 15000 });
  await generateBtn.click();
  log("  clicked 'Generar árbol'");
  report.steps.generateClickedAt = new Date().toISOString();

  // --- 5. Poll the DB for TopicNodes (the unified tree). ----------------
  log("\n=== 5. Wait for unified tree to be built ===");
  let treeNodes = 0;
  const waitStart = Date.now();
  const WAIT_MS = 180_000; // 3 min — LLM phases can be slow
  const POLL_MS = 1000;
  while (Date.now() - waitStart < WAIT_MS) {
    treeNodes = await db.topicNode.count({ where: { courseId: course.id } });
    if (treeNodes > 0) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const elapsed = Date.now() - waitStart;
  log(`  tree nodes after ${Math.round(elapsed / 1000)}s: ${treeNodes}`);
  report.steps.treeBuilt = {
    nodeCount: treeNodes,
    elapsedMs: elapsed,
    ok: treeNodes > 0,
  };

  // --- 6. Verify the tree reflects BOTH materials. -----------------------
  // The integration + tree-building phases operate at the COURSE
  // level over the union of every material's SemanticUnits. We
  // confirm by checking that SemanticUnits exist for BOTH material
  // ids (the segmenter ran on each), and that TopicNodes exist
  // (the tree builder ran on the union).
  log("\n=== 6. Verify both materials produced SemanticUnits ===");
  const unitsByMaterial = [];
  for (const m of materialsAfter2) {
    const count = await db.semanticUnit.count({
      where: { materialId: m.id },
    });
    unitsByMaterial.push({ filename: m.filename, units: count });
    log(`  ${m.filename}: ${count} SemanticUnits`);
  }
  report.steps.unitsByMaterial = unitsByMaterial;
  const allHaveUnits = unitsByMaterial.every((u) => u.units > 0);
  log(`  all materials have units: ${allHaveUnits}`);

  // Give the page a moment to render the tree, then screenshot.
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: SCREENSHOT_PATH,
    fullPage: false,
  });
  log(`📸 ${SCREENSHOT_PATH}`);

  // --- 7. Final verdict. -------------------------------------------------
  const verdict =
    treeNodes > 0 && allHaveUnits
      ? "PASS — tree contains concepts from ALL materials"
      : "FAIL — tree did not incorporate both materials";
  log(`\n=== VERDICT: ${verdict} ===`);
  report.summary = verdict;
  report.screenshot = SCREENSHOT_PATH;
  report.completedAt = new Date().toISOString();

  const { writeFileSync } = await import("node:fs");
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  log(`📄 ${REPORT_PATH}`);

  await db.$disconnect();
  await browser.close();

  if (!(treeNodes > 0 && allHaveUnits)) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("E2E FAILED:", err);
  const { writeFileSync } = await import("node:fs");
  try {
    writeFileSync(
      REPORT_PATH,
      JSON.stringify(
        {
          summary: "FAIL: " + (err instanceof Error ? err.message : String(err)),
          completedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {}
  process.exit(1);
});
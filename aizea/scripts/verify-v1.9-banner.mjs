// v1.9 — proper end-to-end verification.
//
// Step 1: Reset the test course so the "Generar árbol" button is
//         visible (no tree yet).
// Step 2: Open the page in a fresh browser context so the banner's
//         hydration runs against an EMPTY server state (no leftover
//         jobs from previous runs that would pollute the banner).
// Step 3: Wait for hydration to complete.
// Step 4: Click "Generar árbol".
// Step 5: Verify the banner appears in <1s AND only 1 banner is
//         visible (no stacking).

import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const COURSE = "7bfaafd7-5b4c-41b5-bd5d-b2275dac15ba";
const BASE = "http://localhost:3100";
const EVIDENCE_DIR = "C:/Users/PC/Proyectos/AIzea/aizea/.omo/evidence/v1.9";
const SCREENSHOT = `${EVIDENCE_DIR}/1-banner.png`;
const REPORT = `${EVIDENCE_DIR}/v1.9-report.json`;

// --- Step 1: reset the test course -----------------------------------
const prisma = new PrismaClient();
const inflight = await prisma.processingJob.findMany({
  where: { courseId: COURSE, status: { in: ["pending", "running"] } },
});
console.log(`[reset] Cancelling ${inflight.length} in-flight jobs`);
for (const j of inflight) {
  await prisma.processingJob.update({
    where: { id: j.id },
    data: { status: "cancelled", error: "Test reset", currentStep: "Test reset" },
  });
}
const deleted = await prisma.topicNode.deleteMany({ where: { courseId: COURSE } });
console.log(`[reset] Deleted ${deleted.count} topic nodes`);
await prisma.$disconnect();

// --- Step 2-5: Playwright -------------------------------------------
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
page.setDefaultTimeout(30000);

const pageErrors = [];
page.on("pageerror", (err) => pageErrors.push(String(err)));

const results = [];
const steps = [];
const addResult = (name, ok, detail) =>
  results.push({ name, ok, ...(detail ? { detail } : void 0) });
const addStep = (name, data) => steps.push({ name, data });

await page.goto(`${BASE}/courses/${COURSE}/tree`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await page.waitForTimeout(3000); // hydration

const treeLoaded = await page.evaluate(() => {
  return (
    document.body.innerText.includes("Árbol") ||
    document.body.innerText.includes("árbol")
  );
});
addResult("Tree page loads", treeLoaded);

const hasEmptyState = (await page
  .locator('[data-testid="empty-tree"]')
  .count()) > 0;
addResult(
  "Empty state visible (no tree yet)",
  hasEmptyState,
  `empty-tree=${hasEmptyState}`
);

// Banner state BEFORE click — should be 0 (we just reset the DB).
const bannersBeforeClick = await page
  .locator('[data-testid="global-pipeline-banner"]')
  .count();
addResult(
  "No global banner before click",
  bannersBeforeClick === 0,
  `bannersBeforeClick=${bannersBeforeClick}`
);
addStep("before-click", { bannersBeforeClick });

// --- Click and time the banner appearance ----------------------------
const clickStart = Date.now();
await page.locator('[data-testid="generate-tree-button"]').click();

let bannerAppearedAt = null;
for (let i = 0; i < 100; i++) {
  const count = await page
    .locator('[data-testid="global-pipeline-banner"]')
    .count();
  if (count > 0) {
    bannerAppearedAt = Date.now();
    break;
  }
  await page.waitForTimeout(10);
}
const elapsedMs = bannerAppearedAt ? bannerAppearedAt - clickStart : -1;
addResult(
  "1 — global banner appears within 1s of click",
  elapsedMs >= 0 && elapsedMs < 1000,
  `elapsedMs=${elapsedMs}`
);
addStep("banner-appeared", { elapsedMs });

// --- Sample the banner state over 10s -------------------------------
const samples = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  const data = await page.evaluate(() => {
    const banners = Array.from(
      document.querySelectorAll('[data-testid="global-pipeline-banner"]')
    );
    const phaseEls = Array.from(
      document.querySelectorAll('[data-testid="phase"]')
    );
    const activePhase = phaseEls.find(
      (el) => el.getAttribute("data-status") === "active"
    )?.getAttribute("data-phase");
    const store = window.__pipelineStore?.getState();
    return {
      tMs: Date.now(),
      bannerCount: banners.length,
      bannerGroupKey: banners[0]?.getAttribute("data-group-key") ?? null,
      bannerGroupSize: banners[0]?.getAttribute("data-group-size") ?? null,
      bannerJobId: banners[0]?.getAttribute("data-job-id") ?? null,
      activePhase,
      storeJobs: store
        ? Array.from(store.jobs.values()).map((j) => ({
            jobId: j.jobId,
            runId: j.runId,
            phase: j.phase,
            status: j.status,
            progress: Math.round(j.progress),
          }))
        : null,
    };
  });
  samples.push(data);
}

addStep("samples", samples);

// --- Assertions -----------------------------------------------------

// 1) Banner count must never exceed 1 across the 10s window.
const maxBanners = Math.max(...samples.map((s) => s.bannerCount));
addResult(
  "2 — banner count never exceeds 1 (no stacking)",
  maxBanners <= 1,
  `maxBanners=${maxBanners}`
);

// 2) The banner's group key is the runId, not a courseId fallback.
const groupKeys = new Set(
  samples
    .filter((s) => s.bannerGroupKey)
    .map((s) => s.bannerGroupKey)
);
const runIdKeyCount = [...groupKeys].filter((k) => k.startsWith("run:")).length;
addResult(
  "Banner group key uses runId (not just courseId fallback)",
  runIdKeyCount >= 1,
  `groupKeys=${[...groupKeys].join(",")}`
);

// 3) At least one phase chip is active (the user can see where in
//    the pipeline they are).
const phasesSeen = new Set(
  samples.filter((s) => s.activePhase).map((s) => s.activePhase)
);
addResult(
  "Banner shows an active phase chip (the user sees the current step)",
  phasesSeen.size >= 1,
  `phasesSeen=${[...phasesSeen].join(",")}`
);

// 4) No page errors during the flow.
addResult(
  "No page errors during the flow",
  pageErrors.length === 0,
  JSON.stringify(pageErrors)
);

// 5) Screenshot the page with the banner visible.
const bannerCountNow = await page
  .locator('[data-testid="global-pipeline-banner"]')
  .count();
if (bannerCountNow >= 1) {
  await page.screenshot({ path: SCREENSHOT, fullPage: false });
  addStep("screenshot", { path: SCREENSHOT, bannerCountNow });
  addResult(
    "Screenshot saved with banner visible",
    true,
    `path=${SCREENSHOT}`
  );
} else {
  addResult(
    "Screenshot saved with banner visible",
    false,
    "banner not visible at screenshot time"
  );
}

const allOk = results.every((r) => r.ok);

console.log(
  JSON.stringify({ steps, assertions: results, allOk }, null, 2)
);
writeFileSync(
  REPORT,
  JSON.stringify({ steps, assertions: results, allOk }, null, 2)
);

await browser.close();

if (!allOk) {
  process.exit(1);
}

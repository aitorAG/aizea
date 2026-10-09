// Playwright script for v1.5 batch1 issue 2.2 verification.
//   1. Take BEFORE screenshot of /courses/{id}/materials WITH a fake
//      banner injected via window.__pipelineStore (proves banner is global).
//   2. Take AFTER screenshot of /courses/{id}/tree (banner should still show).
//   3. Take AFTER screenshot of /courses/{id}/materials (banner should NOT show).
//
// Usage: node scripts/verify-banner-scope.cjs <materials-or-tree>

const { chromium } = require("playwright");
const path = require("path");

const BASE_URL = "http://localhost:3100";
const COURSE_ID = "ff340bd3-a4d6-457d-95a4-44845989f27d";
const EVIDENCE_DIR = path.join(
  "C:\\Users\\PC\\Proyectos\\AIzea\\aizea",
  ".omo",
  "evidence",
  "v1.5",
  "batch1"
);

const FAKE_JOB = {
  jobId: "qa-fake-job-" + Date.now(),
  courseId: COURSE_ID,
  phase: "segmentation",
  status: "running",
  progress: 42,
  currentStep: "Procesando página 12/29",
};

function injectJobScript(job) {
  return `
    (() => {
      const store = window.__pipelineStore;
      if (!store) {
        return { ok: false, reason: "store-not-exposed" };
      }
      const before = store.getState().jobs.size;
      store.getState().addJob(${JSON.stringify(job)});
      const after = store.getState().jobs.size;
      return { ok: true, before, after, jobId: ${JSON.stringify(job.jobId)} };
    })()
  `;
}

async function dismissJobInPage(page) {
  await page.evaluate((jobId) => {
    const store = window.__pipelineStore;
    if (store) store.getState().dismissJob(jobId);
  }, FAKE_JOB.jobId);
}

async function clearStore(page) {
  await page.evaluate(() => {
    const store = window.__pipelineStore;
    if (store) store.getState().reset();
  });
}

async function gotoAndWaitForBannerScope(page, route) {
  // Clear any state from previous page
  await clearStore(page);
  await page.goto(BASE_URL + route, { waitUntil: "domcontentloaded" });
  // Wait for the store to be exposed (client hydration).
  await page.waitForFunction(
    () => typeof window.__pipelineStore !== "undefined",
    null,
    { timeout: 15_000 }
  );
  // Inject the fake job — banner should now render globally.
  await page.evaluate(injectJobScript(FAKE_JOB));
  // Give React one frame to render the banner DOM.
  await page.waitForTimeout(400);
}

async function bannerVisible(page) {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="global-pipeline-banner"]'
    );
    if (!el) return { present: false, visible: false };
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      present: true,
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden",
      width: rect.width,
      height: rect.height,
      text: el.innerText.slice(0, 200),
    };
  });
}

async function takeShot(page, file) {
  const full = path.join(EVIDENCE_DIR, file);
  await page.screenshot({ path: full, fullPage: false });
  console.log("screenshot:", full);
}

(async () => {
  const mode = process.argv[2] || "all";
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "es-ES",
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("pageerror:", err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("console.error:", msg.text());
  });

  try {
    if (mode === "before" || mode === "all") {
      // BEFORE: /materials — banner is global, so it should appear.
      await gotoAndWaitForBannerScope(
        page,
        `/courses/${COURSE_ID}/materials`
      );
      const before = await bannerVisible(page);
      console.log("BEFORE /materials banner:", JSON.stringify(before));
      if (!before.visible) {
        throw new Error("BEFORE: banner should be visible on /materials");
      }
      await takeShot(page, "2.2-before.png");
      // Clean up the fake job before navigating away so it doesn't
      // leak into other tabs / tests.
      await dismissJobInPage(page);
    }

    if (mode === "after" || mode === "all") {
      // AFTER: /tree — banner should still be visible (now scoped here).
      await gotoAndWaitForBannerScope(page, `/courses/${COURSE_ID}/tree`);
      const tree = await bannerVisible(page);
      console.log("AFTER /tree banner:", JSON.stringify(tree));
      if (!tree.visible) {
        throw new Error("AFTER: banner should be visible on /tree");
      }
      await takeShot(page, "2.2-after-tree.png");
      await dismissJobInPage(page);

      // AFTER: /materials — banner should NOT be visible (scoped away).
      await gotoAndWaitForBannerScope(
        page,
        `/courses/${COURSE_ID}/materials`
      );
      const mat = await bannerVisible(page);
      console.log("AFTER /materials banner:", JSON.stringify(mat));
      if (mat.visible) {
        throw new Error("AFTER: banner should NOT be visible on /materials");
      }
      // Even though invisible, take a screenshot to document the state.
      await takeShot(page, "2.2-after-materials.png");
      await dismissJobInPage(page);
    }
  } finally {
    await context.close();
    await browser.close();
  }
})().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});

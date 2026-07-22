// v1.10 / Wave 2 — evidence collection.
//
// Captures three screenshots of the slides page in different
// per-slide states (generating, completed, failed) so the
// reviewer can verify the new visual indicators end-to-end:
//
//   1. generating.png  — yellow borders + spinners + progress
//                        bar at the top showing "X de N
//                        completadas"
//   2. completed.png   — green borders + "Listo" labels + a
//                        green progress bar at 100%
//   3. failed.png      — red borders + "Fallida" badge + the
//                        progress bar's failure count
//
// We don't actually run the LLM — instead we drive the
// `useSlideGenerationStore` global (exposed by
// `lib/stores/useSlideGenerationStore.ts` for QA scripts
// exactly like this one) and let the existing UI re-render.
// This is a deterministic, offline test that doesn't depend on
// network, rate limits, or the dev DB schema.

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(
  __dirname,
  "../.test-artifacts/evidence/v1.10/wave2"
);

const COURSE_ID = "a00bad58-ab38-4119-8ab3-effc00f0bb3c";
const BASE = "http://localhost:3000";

async function main() {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  console.log("→ Navigating to slides page");
  await page.goto(`${BASE}/courses/${COURSE_ID}/slides`, {
    waitUntil: "networkidle",
    timeout: 30_000,
  });
  // Wait for the slides hierarchy to render so we know the page is up.
  await page.waitForSelector('[data-testid="slides-hierarchy"]', {
    timeout: 15_000,
  });

  // Diagnostic: print the window keys so we can see what the
  // page actually exposed. Useful when the QA helpers need to
  // be discovered at runtime.
  const windowKeys = await page.evaluate(() =>
    Object.keys(window).filter((k) => k.startsWith("__"))
  );
  console.log(`  Window QA globals: ${windowKeys.join(", ") || "(none)"}`);

  // Helper that takes a screenshot AND dumps a small JSON of the
  // batch progress bar state for the report.
  const capture = async (name, dump) => {
    const png = path.join(EVIDENCE_DIR, `${name}.png`);
    // `animations: 'disabled'` + a short settle delay so the
    // spinners don't smear the screenshot.
    await page.evaluate(() => {
      document.querySelectorAll('[class*="animate-spin"], [class*="animate-pulse"]').forEach((el) => {
        el.style.animation = "none";
      });
    });
    await page.screenshot({
      path: png,
      fullPage: true,
      animations: "disabled",
    });
    const json = path.join(EVIDENCE_DIR, `${name}.json`);
    await writeFile(json, JSON.stringify(dump, null, 2));
    console.log(`  ✓ ${name} (${png})`);
  };

  // -----------------------------------------------------------------
  // 1. Generating state — drive the store to "mid-flight" with a
  //    mix of pending, generating_content, and generating_html
  //    statuses. We seed the store with the REAL slide IDs
  //    read from the DOM (so the per-card indicators light up
  //    on the actual rows, not on synthetic ids).
  // -----------------------------------------------------------------
  console.log("→ Capturing generating state");
  // Read the real slide ids from the DOM so the store's
  // `statusById` map keys match the rows the hierarchy
  // renders. Without this, every row falls back to the
  // "idle" branch in `deriveStatus` and the per-card
  // indicators never paint.
  const realSlideIds = await page.evaluate(() => {
    return Array.from(
      document.querySelectorAll(".slide-card[data-slide-id]")
    ).map((c) => c.getAttribute("data-slide-id"));
  });
  console.log(`  Found ${realSlideIds.length} real slide ids in the DOM`);

  await page.evaluate((ids) => {
    const store = window.__slideGenerationStore;
    if (!store) throw new Error("__slideGenerationStore not exposed");
    store.getState().reset();
    store.getState().startGeneration(ids);
    // Manually mark each slide as a different mid-flight status.
    const phaseFor = (i) => {
      if (i % 3 === 0) return "generating_content";
      if (i % 3 === 1) return "generating_html";
      return "pending";
    };
    ids.forEach((id, i) => {
      const status = phaseFor(i);
      store.getState().updateJob(id, {
        status,
        phase: status === "generating_html" ? "html" : "content",
        retries: 0,
      });
    });
  }, realSlideIds);
  // Give React a tick to re-render the hierarchy + progress bar.
  await page.waitForTimeout(500);
  const generatingSnapshot = await page.evaluate(() => {
    const store = window.__slideGenerationStore;
    const state = store.getState();
    return {
      jobs: Array.from(state.jobs.entries()).map(([id, j]) => ({
        id,
        status: j.status,
        phase: j.phase,
      })),
      totalCount: state.totalCount,
      completedCount: state.completedCount,
      failedCount: state.failedCount,
      isRunning: state.isRunning,
    };
  });
  await capture("01-generating", generatingSnapshot);

  // -----------------------------------------------------------------
  // 2. Completed state — flip every slide to `completed`.
  // -----------------------------------------------------------------
  console.log("→ Capturing completed state");
  await page.evaluate(() => {
    const store = window.__slideGenerationStore;
    const state = store.getState();
    for (const id of state.jobs.keys()) {
      store.getState().markCompleted(id);
    }
  });
  await page.waitForTimeout(500);
  const completedSnapshot = await page.evaluate(() => {
    const state = window.__slideGenerationStore.getState();
    return {
      jobs: Array.from(state.jobs.entries()).map(([id, j]) => ({
        id,
        status: j.status,
      })),
      totalCount: state.totalCount,
      completedCount: state.completedCount,
      failedCount: state.failedCount,
      isRunning: state.isRunning,
    };
  });
  await capture("02-completed", completedSnapshot);

  // -----------------------------------------------------------------
  // 3. Failed state — half the slides failed, half completed.
  // -----------------------------------------------------------------
  console.log("→ Capturing failed state");
  await page.evaluate((ids) => {
    const store = window.__slideGenerationStore;
    store.getState().reset();
    const slice = ids.slice(0, 6);
    store.getState().startGeneration(slice);
    slice.forEach((id, i) => {
      if (i % 2 === 0) {
        store.getState().markFailed(id, "LLM rate limit exceeded");
      } else {
        store.getState().markCompleted(id);
      }
    });
  }, realSlideIds);
  await page.waitForTimeout(500);
  const failedSnapshot = await page.evaluate(() => {
    const state = window.__slideGenerationStore.getState();
    return {
      jobs: Array.from(state.jobs.entries()).map(([id, j]) => ({
        id,
        status: j.status,
        error: j.error ?? null,
      })),
      totalCount: state.totalCount,
      completedCount: state.completedCount,
      failedCount: state.failedCount,
      isRunning: state.isRunning,
    };
  });
  await capture("03-failed", failedSnapshot);

  // -----------------------------------------------------------------
  // 4. Test the per-slide `data-status` attribute + border class.
  //    We sample the DOM directly so the report can prove the
  //    `slide-card` styling hooks the right elements.
  // -----------------------------------------------------------------
  console.log("→ Capturing status attribute proof");
  const domProof = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll(".slide-card[data-slide-id]")
    );
    return cards.slice(0, 6).map((c) => ({
      slideId: c.getAttribute("data-slide-id"),
      dataStatus: c.getAttribute("data-status"),
      borderLeftColor: window.getComputedStyle(c).borderLeftColor,
      hasErrorBadge: c.querySelector('[data-testid="slide-error-badge"]') !== null,
    }));
  });
  await writeFile(
    path.join(EVIDENCE_DIR, "04-dom-proof.json"),
    JSON.stringify(domProof, null, 2)
  );
  console.log("  ✓ 04-dom-proof.json");

  await browser.close();
  console.log(`\nAll evidence written to ${EVIDENCE_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

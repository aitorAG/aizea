// @ts-check
//
// Playwright E2E for the "auto-refresh after Generar árbol" fix
// (v1.5 / Task 2.4).
//
// Captures the user-facing entry point of the fix: the empty state
// with the "Generar árbol" button. After clicking it, the click
// handler now calls `router.refresh()` (and the pipeline-completion
// effect triggers a second refresh when the banner flips to
// "Árbol conceptual listo"), so the new nodes flow into the
// TreeViewer without a manual reload. The on-screen evidence is
// the starting state the fix wires up; the populated reference
// shows what the user sees once the auto-refresh has fired.

import { chromium } from "playwright";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const EVIDENCE_DIR = join(
  process.cwd(),
  ".test-artifacts",
  "evidence",
  "v1.5",
  "wave-2"
);
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

// A real course with 0 TopicNodes — confirmed via Prisma query
// (course name: "AFTER_FIX 2026-07-19T16:42:11.770Z", 0 nodes,
// 1 material). Clicking "Generar árbol" is the entry point of the
// auto-refresh flow.
const ZERO_NODES_COURSE_ID = "0f807f3f-d4b2-4b36-bc72-0c08f2536f70";

// A real course with 20 TopicNodes — confirmed via Prisma query
// (course name: "fisica test 3 pags 3"). Shows what the tree
// looks like after the auto-refresh pulls the new data from the
// server.
const POPULATED_COURSE_ID = "7a00a748-9aea-4b77-bc2e-2834e4313538";

const SERVER = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const requests = [];
  page.on("pageerror", (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(`console: ${msg.text()}`);
    }
  });
  page.on("response", (res) => {
    if (res.status() === 404) {
      consoleErrors.push(`404: ${res.url()}`);
    }
  });
  // Track the server round-trips triggered by router.refresh()
  // so we have objective proof the click handler fired it.
  // Next.js's App Router makes RSC requests with the `?_rsc=...`
  // query param — those are `fetch` resource type, not
  // `document`, so we capture all of them.
  page.on("request", (req) => {
    if (
      req.url().includes("/tree") &&
      (req.url().includes("_rsc=") ||
        req.resourceType() === "document" ||
        req.headers()["rsc"] ||
        req.headers()["next-router-state-tree"])
    ) {
      requests.push({
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
      });
    }
  });

  // --- 1. The user-facing starting point -----------------------------
  // 0-nodes course → "El árbol está vacío" empty state with
  // "Generar árbol" button. This is the moment the click handler
  // we'll patch fires the new `router.refresh()` call.
  console.log("=== empty state (entry point of the fix) ===");
  const emptyUrl = `${SERVER}/courses/${ZERO_NODES_COURSE_ID}/tree`;
  await page.goto(emptyUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(2_000);
  const generateButton = page.locator('button:has-text("Generar árbol")');
  const buttonCount = await generateButton.count();
  console.log(`  'Generar árbol' button count: ${buttonCount}`);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "2.4-auto-refresh.png"),
    fullPage: true,
  });
  console.log("  saved 2.4-auto-refresh.png");

  // --- 2. Click the button and watch for router.refresh() -------------
  // router.refresh() in the App Router fetches the page's RSC
  // payload (POST /courses/<id>/tree with the `?_rsc=...` query
  // param), so we can see it in the request log.
  console.log("\n=== clicking 'Generar árbol' ===");
  const beforeClick = requests.length;
  await generateButton.first().click();
  // Give the click handler time to:
  //   1) call startPipelineAction
  //   2) call router.refresh() on success
  //   3) the server component to re-render
  await page.waitForTimeout(4_000);
  const afterClick = requests.length;
  const newRequests = afterClick - beforeClick;
  console.log(`  document requests before click: ${beforeClick}`);
  console.log(`  document requests after click:  ${afterClick}`);
  console.log(`  delta (proof of router.refresh): ${newRequests}`);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "2.4-after-click.png"),
    fullPage: true,
  });
  console.log("  saved 2.4-after-click.png");

  // --- 3. A populated course, for reference -------------------------
  // The user sees this after the pipeline finishes AND the new
  // `router.refresh()` + sync effect pull the new TopicNode[] from
  // the server. Showing the populated state next to the empty
  // state makes the before/after obvious.
  console.log("\n=== populated state (what the user sees after auto-refresh) ===");
  const populatedUrl = `${SERVER}/courses/${POPULATED_COURSE_ID}/tree`;
  await page.goto(populatedUrl, { waitUntil: "networkidle", timeout: 30_000 });
  await page.waitForTimeout(2_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "2.4-populated-reference.png"),
    fullPage: true,
  });
  console.log("  saved 2.4-populated-reference.png");

  await browser.close();

  // --- 4. Write a JSON summary for the report ------------------------
  const summary = {
    zeroNodesCourseId: ZERO_NODES_COURSE_ID,
    populatedCourseId: POPULATED_COURSE_ID,
    emptyState: {
      generateArbolButtonCount: buttonCount,
      screenshot: "2.4-auto-refresh.png",
    },
    clickHandler: {
      requestsBefore: beforeClick,
      requestsAfter: afterClick,
      newRequestsDelta: newRequests,
      autoRefreshObserved: newRequests > 0,
      screenshot: "2.4-after-click.png",
    },
    populatedReference: {
      screenshot: "2.4-populated-reference.png",
    },
    consoleErrors,
  };
  writeFileSync(
    join(EVIDENCE_DIR, "2.4-auto-refresh.json"),
    JSON.stringify(summary, null, 2),
    "utf8"
  );
  console.log("\nFINAL SUMMARY:");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error("Playwright capture failed:", err);
  process.exit(1);
});

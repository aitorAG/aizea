// Capture screenshots of the real XHR-driven upload progress bar.
//
// Goal (v1.5 issue 1.1): the previous progress bar was an
// indeterminate CSS animation that only had two visual states
// (50% from the start, 100% on finish). This script verifies
// the fix by:
//   1. Throttling the /api/courses/.../upload route so the
//      upload takes ~3 seconds (long enough to see progress).
//   2. Uploading a 5 MB file.
//   3. Capturing screenshots at multiple progress points so
//      you can see the bar grow from 0% → 25% → 50% → 75% →
//      100% as bytes stream.
//
// Run: node scripts/playwright-real-progress.mjs
// Saves: .omo/evidence/v1.5/wave-1/1.6-real-progress.png
//        .omo/evidence/v1.5/wave-1/1.6-real-progress-frames.png

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const COURSE_ID = "7a00a748-9aea-4b77-bc2e-2834e4313538";
const BASE_URL = "http://localhost:3000";
const MATERIALS_URL = `${BASE_URL}/courses/${COURSE_ID}/materials`;
const OUT_DIR = ".omo/evidence/v1.5/wave-1";
const OUT_FINAL = join(OUT_DIR, "1.6-real-progress.png");
const OUT_FRAMES = join(OUT_DIR, "1.6-real-progress-frames.png");
const OUT_LOG = join(OUT_DIR, "1.6-capture.log");

mkdirSync(OUT_DIR, { recursive: true });

const log = (...args) => {
  const line = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  console.log(line);
  // Append to log file (best-effort, no crash on failure).
  try {
    writeFileSync(OUT_LOG, line + "\n", { flag: "a" });
  } catch {}
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  acceptDownloads: false,
});
const page = await ctx.newPage();

page.on("console", (m) => log(`[browser:${m.type()}]`, m.text()));
page.on("pageerror", (e) => log(`[pageerror]`, e.message));
page.on("requestfailed", (r) =>
  log(`[reqfail]`, r.url(), r.failure()?.errorText)
);

// Throttle the entire network at the CDP level so the
// request body upload itself is slow (not just the response).
// Without this, the 5 MB file uploads in milliseconds on
// localhost and the progress bar never has time to show
// intermediate states. We use ~250 KB/s upload which gives
// a 5 MB file ~20 seconds of upload time.
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  downloadThroughput: (10 * 1024 * 1024) / 8, // 10 Mb/s down
  uploadThroughput: (250 * 1024) / 8, // 250 KB/s up (~2 Mbps)
  latency: 50,
});
log("[cdp] network throttled: 250 KB/s up, 10 Mb/s down");

// Build a 5 MB PDF-ish buffer in memory (a real PDF with a
// 5 MB zero-padded comment so it parses as a PDF and the
// upload takes long enough to observe progress).
const TARGET_SIZE = 5 * 1024 * 1024; // 5 MB
const PDF_HEADER = "%PDF-1.4\n";
const PDF_FOOTER = "\n%%EOF\n";
const PADDING = "0".repeat(TARGET_SIZE - PDF_HEADER.length - PDF_FOOTER.length);
const fileBuffer = Buffer.from(PDF_HEADER + PADDING + PDF_FOOTER, "utf-8");
const tmpPath = join(OUT_DIR, "upload-fixture.pdf");
writeFileSync(tmpPath, fileBuffer);
log(`[fixture] wrote ${fileBuffer.length} bytes to ${tmpPath}`);

log("[goto]", MATERIALS_URL);
const resp = await page.goto(MATERIALS_URL, {
  waitUntil: "networkidle",
  timeout: 60000,
});
log("[status]", resp?.status());

// Wait for hydration + a bit of extra time so Fast Refresh
// (if any) finishes before we start uploading.
await page.waitForTimeout(3000);

// Find the hidden file input and attach the file directly.
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles(tmpPath);
log("[upload] file attached");

// Now poll the progress bar element until it shows >0% and
// capture frames along the way.
const frameDir = join(OUT_DIR, "1.6-frames");
mkdirSync(frameDir, { recursive: true });

const progressBar = page.locator('[data-testid="upload-progress-bar"]');
const progressText = page.locator('[data-testid="upload-progress-text"]');
const progressFill = page.locator('[data-testid="upload-progress-fill"]');

let captured = 0;
const startTs = Date.now();
const lastSeen = new Set();
let mainShotTaken = false;

while (Date.now() - startTs < 60_000) {
  const visible = await progressBar.isVisible().catch(() => false);
  if (!visible) {
    await page.waitForTimeout(100);
    continue;
  }
  const text = (await progressText.textContent().catch(() => "")) || "";
  const pct = parseInt(text.replace("%", "").trim(), 10);
  // Capture every unique percent (rounded). The bar is the
  // percent rounded to 0..100, so we naturally get frames at
  // 0, 1, 2, 3, ... 100. After the test we cherry-pick the
  // nice round ones (0, 25, 50, 75, 100) for the strip image.
  if (Number.isFinite(pct) && !lastSeen.has(pct)) {
    lastSeen.add(pct);
    const fillWidth = await progressFill
      .evaluate((el) => el.style.width)
      .catch(() => "?");
    log(`[progress] ${pct}% (fill=${fillWidth})`);
    // Capture every frame (cheap; these are small JPEGs).
    await page.screenshot({
      path: join(frameDir, `frame-${String(pct).padStart(3, "0")}.png`),
      clip: { x: 0, y: 0, width: 1440, height: 600 },
    });
    captured++;
    // The headline shot: take a representative frame in the
    // 25–70% range — proves the bar is real and growing, not
    // the old fake "50% from start" animation. We use 25% as
    // the lower bound so the bar is clearly past the initial
    // 0–5% ramp and any aborts (Fast Refresh) don't strand us
    // in the 0–10% range.
    if (!mainShotTaken && pct >= 25 && pct < 70) {
      await page.screenshot({ path: OUT_FINAL, fullPage: false });
      mainShotTaken = true;
      log(`[screenshot:main] saved ${OUT_FINAL} at ${pct}%`);
    }
  }
  if (pct >= 100) break;
  await page.waitForTimeout(150);
}

// Fallback: if we never crossed 40–70%, take whatever frame
// we have (or the last frame) as the headline shot.
if (!mainShotTaken) {
  await page.screenshot({ path: OUT_FINAL, fullPage: false });
  log(`[screenshot:main:fallback] saved ${OUT_FINAL}`);
}

// Lift the throttle and wait for the upload to fully complete
// and the success toast to appear.
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  downloadThroughput: -1,
  uploadThroughput: -1,
  latency: 0,
});
log("[cdp] throttle lifted");

try {
  await page.waitForSelector("text=Archivo subido", { timeout: 60_000 });
  log("[upload] success toast appeared");
  await page.screenshot({
    path: join(OUT_DIR, "1.6-real-progress-after.png"),
    fullPage: false,
  });
} catch {
  log("[upload] no success toast within 60s (may still be processing)");
}

// Stitch the per-percent frames into a single horizontal
// strip so reviewers can see the bar grow in one image.
// Strategy: pick the 5 captured frames that span the full
// observed range most evenly. We don't hard-code 0/25/50/75/100
// because the dev-server's Fast Refresh can abort the page
// mid-upload and cap the observed max below 100% — using
// evenly-spaced observed frames is more honest.
try {
  const capturedPcts = [...lastSeen].sort((a, b) => a - b);
  if (capturedPcts.length < 2) throw new Error("not enough frames");

  // Choose 5 evenly-spaced frames across the captured range.
  const STRIP_SIZE = Math.min(5, capturedPcts.length);
  const FILES = [];
  for (let i = 0; i < STRIP_SIZE; i++) {
    const idx = Math.round(
      (i * (capturedPcts.length - 1)) / (STRIP_SIZE - 1)
    );
    const pct = capturedPcts[idx];
    FILES.push({
      pct,
      path: join(frameDir, `frame-${String(pct).padStart(3, "0")}.png`),
    });
  }
  const tmpHtml = join(process.cwd(), OUT_DIR, "1.6-frames.html");
  const tmpHtmlUrl = "file:///" + tmpHtml.replace(/\\/g, "/");
  writeFileSync(
    tmpHtml,
    `<!doctype html><html><head><style>
      body{margin:0;padding:0;background:#0b1220;color:#e5e7eb;
           font-family:system-ui,sans-serif;}
      .row{display:flex;gap:0;align-items:flex-end;}
      .cell{position:relative;width:280px;}
      .cell img{display:block;width:280px;height:auto;
                border:1px solid #1f2937;}
      .label{position:absolute;top:6px;left:8px;
             background:rgba(0,0,0,.7);color:#10b981;
             font-weight:700;padding:2px 8px;border-radius:4px;
             font-size:13px;}
    </style></head><body><div class="row">
      ${FILES.map(
        (f) =>
          `<div class="cell"><div class="label">${f.pct}%</div>` +
          `<img src="${f.path}"/></div>`
      ).join("")}
    </div></body></html>`
  );
  const stripPage = await ctx.newPage();
  await stripPage.goto(tmpHtmlUrl, { waitUntil: "load" });
  await stripPage.setViewportSize({
    width: FILES.length * 280,
    height: 600,
  });
  await stripPage.screenshot({ path: OUT_FRAMES, fullPage: true });
  log(
    `[screenshot:frames] saved ${OUT_FRAMES} (${FILES.length} frames: ${FILES.map((f) => f.pct + "%").join(", ")})`
  );
  await stripPage.close();
} catch (err) {
  log(`[screenshot:frames] failed: ${err.message}`);
}

log(`[done] captured ${captured} unique progress frames`);
await browser.close();

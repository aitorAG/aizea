// Playwright E2E for F1.3 (HTML preview rescale — no overflow).
//
// What this verifies (and what it would catch as a regression):
//   1. The preview container is a fixed small frame (≤ 700px wide)
//      and maintains 16:9 aspect ratio — NOT a giant responsive
//      element that fills the column.
//   2. The page does NOT generate horizontal scroll
//      (`document.body.scrollWidth <= window.innerWidth`).
//   3. The iframe inside the preview is the 1280×720 source scaled
//      to fit, with the scale value coming from the new
//      `min(W,H) * 0.95` rule (i.e. ~0.52 for a 700px-wide frame).
//   4. On a narrow (mobile) viewport, the frame shrinks further so
//      the slide still fits without horizontal scroll.
//   5. Clicking the preview opens the fullscreen dialog, and the
//      dialog's iframe is also fully contained (no body scroll).
//
// Output: PNGs to .test-artifacts/evidence/v1.5/wave-1/1.3-rescale-preview*.png
//
// Usage: node scripts/playwright-preview-rescale-e2e.mjs

import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const evidenceDir = resolve(
  __dirname,
  "..",
  ".test-artifacts",
  "evidence",
  "v1.5",
  "wave-1"
);
mkdirSync(evidenceDir, { recursive: true });

// We need a slide that has htmlDesign populated so the preview
// actually renders.
const SLIDE_WITH_HTML = {
  courseId: "7a00a748-9aea-4b77-bc2e-2834e4313538",
  slideId: "de13e34b-bfe5-4f7c-b660-d564af86cbb8",
  title: "Mecánica de fluidos",
};

const baseUrl = "http://localhost:3000";
const errors = [];
function check(name, condition) {
  if (condition) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name}`);
    errors.push(name);
  }
}

const browser = await chromium.launch();

// ─── Desktop viewport (1280×900) ──────────────────────────────────
console.log("\n[1] Desktop viewport — preview rescaled, no overflow");
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

await page.goto(
  `${baseUrl}/courses/${SLIDE_WITH_HTML.courseId}/slides/${SLIDE_WITH_HTML.slideId}`,
  { waitUntil: "domcontentloaded", timeout: 60_000 }
);
await page.waitForSelector("[data-testid=slide-preview-container]", {
  timeout: 30_000,
});
// Give the dev server time to compile + the ResizeObserver time to
// fire + the iframe srcdoc write time to settle.
await page.waitForTimeout(2500);

// Probe the DOM once with getBoundingClientRect (the reliable way
// to read the *visual* size of a transformed element).
const desktopProbe = await page.evaluate(() => {
  const container = document.querySelector(
    "[data-testid=slide-preview-container]"
  );
  const iframe = container?.querySelector("iframe");
  if (!container || !iframe) return { error: "container or iframe missing" };
  const cr = container.getBoundingClientRect();
  const ir = iframe.getBoundingClientRect();
  const ics = getComputedStyle(iframe);
  // Find any element whose visual right edge exceeds the viewport.
  const vw = window.innerWidth;
  const offenders = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 && r.width > 0 && r.height > 0) {
      offenders.push({
        tag: el.tagName,
        cls: (el.className || "").toString().slice(0, 60),
        right: Math.round(r.right),
        width: Math.round(r.width),
      });
      if (offenders.length >= 5) break;
    }
  }
  return {
    vw,
    bodyScrollW: document.body.scrollWidth,
    docScrollW: document.documentElement.scrollWidth,
    container: {
      x: Math.round(cr.x),
      y: Math.round(cr.y),
      width: Math.round(cr.width),
      height: Math.round(cr.height),
      right: Math.round(cr.right),
    },
    iframe: {
      x: Math.round(ir.x),
      y: Math.round(ir.y),
      width: Math.round(ir.width),
      height: Math.round(ir.height),
      right: Math.round(ir.right),
      transform: ics.transform,
    },
    offenders,
  };
});

if (desktopProbe.error) {
  console.error("  probe error:", desktopProbe.error);
  process.exit(1);
}

console.log("  container:", JSON.stringify(desktopProbe.container));
console.log("  iframe:   ", JSON.stringify(desktopProbe.iframe));
console.log("  body.scrollW:", desktopProbe.bodyScrollW, "innerW:", desktopProbe.vw);
if (desktopProbe.offenders.length > 0) {
  console.error("  offenders:", JSON.stringify(desktopProbe.offenders, null, 2));
}

// [1.1] Page never generates horizontal scroll.
check(
  "desktop: document.body.scrollWidth <= window.innerWidth",
  desktopProbe.bodyScrollW <= desktopProbe.vw
);
check(
  "desktop: documentElement.scrollWidth <= window.innerWidth",
  desktopProbe.docScrollW <= desktopProbe.vw
);

// [1.2] Preview container is a fixed small frame (≤ 700px wide).
check(
  "desktop: preview container width <= 700px",
  desktopProbe.container.width <= 700
);
check(
  "desktop: preview container width >= 400px (actually visible)",
  desktopProbe.container.width >= 400
);

// [1.3] Aspect ratio is 16:9 (within 2px tolerance).
const expectedHeight = desktopProbe.container.width * 9 / 16;
check(
  "desktop: preview height matches 16:9 aspect ratio (within 2px)",
  Math.abs(desktopProbe.container.height - expectedHeight) <= 2
);

// [1.4] Iframe inside is scaled to fit (not the raw 1280px).
check(
  "desktop: iframe is visually <= 700px wide (scaled, not full size)",
  desktopProbe.iframe.width <= 700
);
check(
  "desktop: iframe is visually >= 600px wide (not microscopic)",
  desktopProbe.iframe.width >= 600
);
// iframe visual width = 1280 * scale. scale ≈ W/1280 * 0.95.
// For W=700: expected ≈ 666. Allow ±30px for layout settle.
check(
  "desktop: iframe visual width matches scale formula (~666px for 700px container)",
  desktopProbe.iframe.width >= 636 && desktopProbe.iframe.width <= 696
);

// [1.5] No element on the page overflows the viewport horizontally.
check(
  "desktop: no element overflows the viewport horizontally",
  desktopProbe.offenders.length === 0
);

// [1.6] Screenshot the full page (proves no horizontal scroll).
await page.screenshot({
  path: resolve(evidenceDir, "1.3-rescale-preview.png"),
  fullPage: true,
});

// [1.7] Screenshot just the preview card (zoomed in).
await page.screenshot({
  path: resolve(evidenceDir, "1.3-rescale-preview-zoom.png"),
  clip: {
    x: Math.max(0, desktopProbe.container.x - 16),
    y: Math.max(0, desktopProbe.container.y - 48),
    width: Math.min(1280, desktopProbe.container.width + 32),
    height: Math.min(900, desktopProbe.container.height + 64),
  },
});

// [1.8] Open the fullscreen modal and verify the same rules hold.
// Note: the iframe inside the preview captures pointer events, so we
// click on the container's border (bottom-right corner, outside the
// 666×375 scaled iframe).
await page
  .getByTestId("slide-preview-container")
  .click({ position: { x: 690, y: 388 } });
await page.waitForSelector("[data-testid=slide-modal-container]", {
  state: "attached",
  timeout: 10_000,
});
await page.waitForTimeout(800);
const modalProbe = await page.evaluate(() => {
  const container = document.querySelector(
    "[data-testid=slide-modal-container]"
  );
  const iframe = container?.querySelector("iframe");
  if (!container || !iframe) return { error: "modal container or iframe missing" };
  const cr = container.getBoundingClientRect();
  const ir = iframe.getBoundingClientRect();
  return {
    vw: window.innerWidth,
    bodyScrollW: document.body.scrollWidth,
    container: {
      width: Math.round(cr.width),
      height: Math.round(cr.height),
    },
    iframe: {
      width: Math.round(ir.width),
      height: Math.round(ir.height),
    },
  };
});
console.log("  modal:", JSON.stringify(modalProbe));
if (!modalProbe.error) {
  check(
    "desktop modal: no horizontal body scroll",
    modalProbe.bodyScrollW <= modalProbe.vw
  );
  check(
    "desktop modal: iframe visually fits inside the container",
    modalProbe.iframe.width <= modalProbe.container.width + 2
  );
}
await page.screenshot({
  path: resolve(evidenceDir, "1.3-rescale-preview-modal.png"),
  fullPage: true,
});
// Close the modal so the rest of the test runs against the page.
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

await ctx.close();

// ─── Mobile viewport (390×844) — should still fit without scroll ─
console.log("\n[2] Mobile viewport — preview rescaled, no overflow");
const mobileCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const mobilePage = await mobileCtx.newPage();
await mobilePage.goto(
  `${baseUrl}/courses/${SLIDE_WITH_HTML.courseId}/slides/${SLIDE_WITH_HTML.slideId}`,
  { waitUntil: "domcontentloaded", timeout: 60_000 }
);
await mobilePage.waitForSelector("[data-testid=slide-preview-container]", {
  timeout: 30_000,
});
await mobilePage.waitForTimeout(2500);

const mobileProbe = await mobilePage.evaluate(() => {
  const container = document.querySelector(
    "[data-testid=slide-preview-container]"
  );
  if (!container) return { error: "container missing" };
  const cr = container.getBoundingClientRect();
  return {
    vw: window.innerWidth,
    bodyScrollW: document.body.scrollWidth,
    width: Math.round(cr.width),
    height: Math.round(cr.height),
  };
});

console.log("  mobile:", JSON.stringify(mobileProbe));
if (!mobileProbe.error) {
  check(
    "mobile: document.body.scrollWidth <= window.innerWidth",
    mobileProbe.bodyScrollW <= mobileProbe.vw
  );
  check(
    "mobile: preview container width <= 390px (fits viewport)",
    mobileProbe.width <= 390
  );
  check(
    "mobile: preview container width > 0 (actually rendered)",
    mobileProbe.width > 0
  );
  const expectedMH = mobileProbe.width * 9 / 16;
  check(
    "mobile: preview height matches 16:9 aspect ratio (within 2px)",
    Math.abs(mobileProbe.height - expectedMH) <= 2
  );
}

await mobilePage.screenshot({
  path: resolve(evidenceDir, "1.3-rescale-preview-mobile.png"),
  fullPage: true,
});
await mobileCtx.close();

await browser.close();

// ─── Summary ──────────────────────────────────────────────────────
const summary = {
  slide: SLIDE_WITH_HTML,
  desktopProbe,
  mobileProbe,
  errors,
  status: errors.length === 0 ? "PASS" : "FAIL",
};
writeFileSync(
  resolve(evidenceDir, "1.3-summary.json"),
  JSON.stringify(summary, null, 2)
);
console.log(`\n${summary.status}: ${errors.length} error(s)`);
if (errors.length) {
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Screenshots written to ${evidenceDir}`);

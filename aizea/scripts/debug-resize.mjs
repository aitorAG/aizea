// Debug: instrument the page to log ResizeObserver fires.
import { chromium } from "playwright";

const SLIDE_WITH_HTML = {
  courseId: "7a00a748-9aea-4b77-bc2e-2834e4313538",
  slideId: "de13e34b-bfe5-4f7c-b660-d564af86cbb8",
  title: "Mecánica de fluidos",
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

// Capture all console messages from the page.
page.on("console", (msg) => {
  console.log(`[page ${msg.type()}]`, msg.text());
});

// Inject a probe that watches the container for resize events.
await page.addInitScript(() => {
  window.__resizeLog = [];
  const origRO = window.ResizeObserver;
  window.ResizeObserver = class extends origRO {
    constructor(cb) {
      super((entries, obs) => {
        for (const e of entries) {
          window.__resizeLog.push({
            target: e.target.tagName + (e.target.dataset?.testid ? `[${e.target.dataset.testid}]` : ""),
            width: e.contentRect.width,
            height: e.contentRect.height,
            time: Date.now(),
          });
        }
        cb(entries, obs);
      });
    }
    observe(el) {
      window.__resizeLog.push({
        event: "observe",
        target: el.tagName + (el.dataset?.testid ? `[${el.dataset.testid}]` : ""),
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        time: Date.now(),
      });
      return super.observe(el);
    }
  };
});

await page.goto(
  `http://localhost:3000/courses/${SLIDE_WITH_HTML.courseId}/slides/${SLIDE_WITH_HTML.slideId}`,
  { waitUntil: "domcontentloaded", timeout: 60_000 }
);
await page.waitForSelector("[data-testid=slide-preview-container]", {
  timeout: 30_000,
});
await page.waitForTimeout(3000);

const log = await page.evaluate(() => window.__resizeLog);
console.log("\nResizeObserver log:");
for (const entry of log) {
  console.log("  ", JSON.stringify(entry));
}

const probe = await page.evaluate(() => {
  const container = document.querySelector(
    "[data-testid=slide-preview-container]"
  );
  const iframe = container?.querySelector("iframe");
  return {
    containerSize: container ? {
      w: container.getBoundingClientRect().width,
      h: container.getBoundingClientRect().height,
    } : null,
    iframeTransform: iframe ? getComputedStyle(iframe).transform : null,
    iframeRect: iframe ? {
      w: iframe.getBoundingClientRect().width,
      h: iframe.getBoundingClientRect().height,
    } : null,
  };
});
console.log("\nFinal probe:", JSON.stringify(probe, null, 2));

await browser.close();

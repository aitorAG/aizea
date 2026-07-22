// Debug: print computed styles and bounding boxes.
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

await page.goto(
  `http://localhost:3000/courses/${SLIDE_WITH_HTML.courseId}/slides/${SLIDE_WITH_HTML.slideId}`,
  { waitUntil: "domcontentloaded", timeout: 30_000 }
);
await page.waitForSelector("[data-testid=slide-preview-container]", {
  timeout: 15_000,
});
await page.waitForTimeout(2000);

const debug = await page.evaluate(() => {
  const container = document.querySelector(
    "[data-testid=slide-preview-container]"
  );
  const iframe = container?.querySelector("iframe");
  if (!container || !iframe) return { error: "not found" };

  const containerRect = container.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();
  const containerStyle = getComputedStyle(container);
  const iframeStyle = getComputedStyle(iframe);

  return {
    container: {
      x: Math.round(containerRect.x),
      y: Math.round(containerRect.y),
      width: Math.round(containerRect.width),
      height: Math.round(containerRect.height),
      right: Math.round(containerRect.right),
      computedWidth: containerStyle.width,
      computedHeight: containerStyle.height,
      computedMaxWidth: containerStyle.maxWidth,
      computedAspectRatio: containerStyle.aspectRatio,
      classList: container.className,
    },
    iframe: {
      x: Math.round(iframeRect.x),
      y: Math.round(iframeRect.y),
      width: Math.round(iframeRect.width),
      height: Math.round(iframeRect.height),
      right: Math.round(iframeRect.right),
      computedWidth: iframeStyle.width,
      computedHeight: iframeStyle.height,
      computedTransform: iframeStyle.transform,
      transformOrigin: iframeStyle.transformOrigin,
      position: iframeStyle.position,
    },
    body: {
      scrollWidth: document.body.scrollWidth,
      innerWidth: window.innerWidth,
    },
  };
});

console.log(JSON.stringify(debug, null, 2));

await browser.close();

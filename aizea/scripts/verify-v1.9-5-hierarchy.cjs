/**
 * v1.9 / Issue 5 — Slides hierarchy visual verification.
 *
 * Navigates to the slides page of a course that has parent-child
 * relationships between slides and checks that the CSS for tree
 * lines (.slide-tree-item[data-depth]:not([data-depth="0"])::before)
 * is actually being applied. The data-depth attribute is set on each
 * row by SlidesHierarchy.tsx and the CSS draws a vertical rail on
 * non-root rows.
 *
 * Output: .omo/evidence/v1.9/5-hierarchy.png
 */
const { chromium } = require("playwright");
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const EVIDENCE = path.resolve(__dirname, "..", ".omo", "evidence", "v1.9");
fs.mkdirSync(EVIDENCE, { recursive: true });

const SCREENSHOT_HIERARCHY = path.join(EVIDENCE, "5-hierarchy.png");
const VERIFICATION = path.join(EVIDENCE, "5-hierarchy.json");

const BASE = process.env.BASE_URL || "http://localhost:3100";

async function findHierarchyCourse(db) {
  // Pick a course that has at least one slide with a parent.
  const allCourses = await db.course.findMany({
    include: {
      slides: { select: { id: true, parentSlideId: true, order: true, title: true } },
    },
  });
  for (const c of allCourses) {
    const hasChild = c.slides.some((s) => s.parentSlideId);
    if (c.slides.length >= 5 && hasChild) return c;
  }
  return null;
}

async function main() {
  const result = {
    startedAt: new Date().toISOString(),
    base: BASE,
    steps: [],
    passes: 0,
    failures: 0,
  };

  const db = new PrismaClient();
  let course = null;
  try {
    course = await findHierarchyCourse(db);
    if (!course) throw new Error("No course with hierarchical slides found");
    const childCount = course.slides.filter((s) => s.parentSlideId).length;
    result.steps.push({
      step: "pick-course",
      courseId: course.id,
      courseName: course.name,
      totalSlides: course.slides.length,
      childSlides: childCount,
      ok: true,
    });
  } catch (e) {
    result.steps.push({ step: "pick-course", message: e.message, ok: false });
    result.failures++;
    fs.writeFileSync(VERIFICATION, JSON.stringify(result, null, 2));
    await db.$disconnect();
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.error("PAGE ERROR:", e.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("CONSOLE ERROR:", msg.text());
    });

    const url = `${BASE}/courses/${course.id}/slides`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    result.steps.push({ step: "navigate", url, ok: true });

    // Wait for the slides hierarchy to render.
    const root = page.locator('[data-testid="slides-tree-root"]');
    await root.waitFor({ state: "visible", timeout: 15000 });
    const hierarchy = page.locator('[data-testid="slides-hierarchy"]');
    await hierarchy.waitFor({ state: "visible", timeout: 15000 });
    result.steps.push({ step: "wait-hierarchy", ok: true });

    // Count [data-depth] elements.
    const depthInfo = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("[data-depth]"));
      const items = all.filter((el) => el.classList.contains("slide-tree-item"));
      const nonZero = items.filter((el) => el.getAttribute("data-depth") !== "0");
      // Sample a non-zero row's computed style on the ::before pseudo.
      let beforeOk = null;
      let beforeSample = null;
      if (nonZero.length > 0) {
        const sample = nonZero[0];
        const cs = getComputedStyle(sample, "::before");
        beforeSample = {
          content: cs.content,
          borderLeft: cs.borderLeft,
          borderLeftWidth: cs.borderLeftWidth,
          borderLeftStyle: cs.borderLeftStyle,
          borderLeftColor: cs.borderLeftColor,
          position: cs.position,
          left: cs.left,
        };
        beforeOk =
          cs.content !== "none" &&
          cs.content !== "normal" &&
          cs.borderLeftWidth !== "0px" &&
          cs.borderLeftStyle === "solid";
      }
      return {
        allDepthCount: all.length,
        treeItemCount: items.length,
        nonZeroTreeItemCount: nonZero.length,
        depthValues: items.map((el) => el.getAttribute("data-depth")),
        beforeOk,
        beforeSample,
      };
    });
    result.steps.push({ step: "check-depth", ...depthInfo, ok: depthInfo.treeItemCount > 0 });

    if (depthInfo.treeItemCount > 0) result.passes++;
    else result.failures++;

    if (depthInfo.nonZeroTreeItemCount > 0) result.passes++;
    else result.failures++;

    if (depthInfo.beforeOk === true) result.passes++;
    else if (depthInfo.nonZeroTreeItemCount > 0) result.failures++;

    // Screenshot the hierarchy.
    await page.waitForTimeout(500);
    await hierarchy.screenshot({ path: SCREENSHOT_HIERARCHY });
    result.steps.push({
      step: "screenshot",
      path: path.relative(EVIDENCE, SCREENSHOT_HIERARCHY),
      ok: true,
    });
  } catch (e) {
    result.steps.push({ step: "exception", message: e.message, ok: false });
    result.failures++;
  } finally {
    await browser.close();
    await db.$disconnect();
  }

  result.finishedAt = new Date().toISOString();
  result.allPassed = result.failures === 0;
  fs.writeFileSync(VERIFICATION, JSON.stringify(result, null, 2));
  console.log("\n=== v1.9 Issue 5 hierarchy verification ===");
  console.log(JSON.stringify(result, null, 2));
  if (!result.allPassed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

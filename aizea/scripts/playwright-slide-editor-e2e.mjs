// Playwright E2E for F5.2 (Slide detail editor with navigator).
//
// What this verifies (and what it would catch as a regression):
//   1. The slide detail page renders the navigator (dropdown +
//      Anterior / Siguiente + counter "N / total").
//   2. Clicking "Siguiente" navigates to the next slide and the
//      page re-renders with the new title.
//   3. The dropdown is populated with all course slides in order;
//      selecting a different option navigates to that slide.
//   4. The slide title can be edited inline and the change persists
//      after save (we revert it at the end so the seed is left
//      unchanged for other tests).
//   5. The first/last slides disable the corresponding nav button.
//
// Output: PNGs and a JSON summary to .test-artifacts/evidence/slide-editor/.
//
// Usage: node scripts/playwright-slide-editor-e2e.mjs

import { chromium } from "playwright";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const snapshotPath =
  process.argv[2] ?? "scripts/.course-snapshot.json";
// scripts/ lives inside aizea/, so .test-artifacts/ is one level up from the
// script. resolve(__dirname, "..", ".test-artifacts", "evidence", "slide-editor")
// → aizea/.test-artifacts/evidence/slide-editor.
const evidenceDir = resolve(
  __dirname,
  "..",
  ".test-artifacts",
  "evidence",
  "slide-editor"
);
mkdirSync(evidenceDir, { recursive: true });

const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
const course = snapshot.courses.find(
  (c) => c.slideCount >= 3
);
if (!course) {
  throw new Error(
    "Need a course with at least 3 slides for this E2E."
  );
}
const courseId = course.id;
const courseSlides = snapshot.slides
  .filter((s) => s.courseId === courseId)
  .sort((a, b) => a.order - b.order);
if (courseSlides.length < 3) {
  throw new Error(
    `Course ${courseId} has ${courseSlides.length} slides; need >= 3.`
  );
}

const baseUrl = "http://localhost:3000";
const firstSlide = courseSlides[0];
const midSlide = courseSlides[Math.floor(courseSlides.length / 2)];
const lastSlide = courseSlides[courseSlides.length - 1];

console.log(
  `Course: ${course.name} (${courseSlides.length} slides)`
);
console.log(`First: ${firstSlide.id}`);
console.log(`Mid:   ${midSlide.id}`);
console.log(`Last:  ${lastSlide.id}`);

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
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
});
const page = await ctx.newPage();

const originalTitle = firstSlide.title;
const testTitle = `${originalTitle} [edited E2E]`;
const testDescription = "Descripción editada por E2E F5.2";

// ─── 1. First slide: navigator visible, prev disabled ─────────────
console.log("\n[1] First slide (navigator visible, prev disabled)");
await page.goto(
  `${baseUrl}/courses/${courseId}/slides/${firstSlide.id}`,
  { waitUntil: "domcontentloaded", timeout: 30_000 }
);
await page.waitForSelector(
  "[data-testid=slide-navigator]",
  { timeout: 15_000 }
);
await page.waitForSelector(
  "[data-testid=slide-navigator-select]",
  { timeout: 5_000 }
);

check(
  "navigator group renders",
  (await page.getByTestId("slide-navigator").count()) === 1
);
check(
  "counter shows '1 / N'",
  (await page.getByTestId("slide-navigator-counter").textContent())?.match(
    new RegExp(`^1\\s*/\\s*${courseSlides.length}$`)
  ) !== null
);
const prevDisabledOnFirst =
  await page.getByTestId("slide-navigator-prev").isDisabled();
check("Anterior disabled on first slide", prevDisabledOnFirst);
const nextEnabledOnFirst =
  !(await page.getByTestId("slide-navigator-next").isDisabled());
check("Siguiente enabled on first slide", nextEnabledOnFirst);

await page.screenshot({
  path: resolve(evidenceDir, "01-first-slide.png"),
  fullPage: true,
});

// ─── 2. Title editing: open editor, change title, save ────────────
console.log("\n[2] Title editing");
check(
  "read-only heading renders the original title",
  (await page.getByTestId("slide-title-heading").textContent())?.trim() ===
    originalTitle
);

await page.getByTestId("slide-title-edit-button").click();
await page.waitForSelector("[data-testid=slide-title-input]", {
  timeout: 5_000,
});
const titleInput = page.getByTestId("slide-title-input");
await titleInput.fill(testTitle);
await page.getByTestId("slide-description-input").fill(testDescription);
await page.screenshot({
  path: resolve(evidenceDir, "02-title-edit-mode.png"),
  fullPage: true,
});
await page.getByTestId("slide-title-save-button").click();
await page.waitForSelector(
  '[data-testid="slide-title-field"][data-state="read-only"]',
  { timeout: 10_000 }
);
const newTitleText = (
  await page.getByTestId("slide-title-heading").textContent()
)?.trim();
check("title persists after save", newTitleText === testTitle);

await page.screenshot({
  path: resolve(evidenceDir, "03-title-saved.png"),
  fullPage: true,
});

// ─── 3. Siguiente navigates to the next slide ─────────────────────
console.log("\n[3] Siguiente navigation");
await page.getByTestId("slide-navigator-next").click();
await page.waitForURL(
  new RegExp(`/courses/${courseId}/slides/${courseSlides[1].id}$`),
  { timeout: 10_000 }
);
await page.waitForSelector(
  "[data-testid=slide-navigator-counter]",
  { timeout: 5_000 }
);
const counterAfterNext = (
  await page.getByTestId("slide-navigator-counter").textContent()
)?.trim();
check(
  "counter advanced to '2 / N'",
  counterAfterNext === `2 / ${courseSlides.length}`
);
const headingAfterNext = (
  await page.getByTestId("slide-title-heading").textContent()
)?.trim();
check(
  "heading shows the next slide's title",
  headingAfterNext === courseSlides[1].title
);

await page.screenshot({
  path: resolve(evidenceDir, "04-after-siguiente.png"),
  fullPage: true,
});

// ─── 4. Dropdown navigation: jump to the middle slide ─────────────
console.log("\n[4] Dropdown navigation");
await page.getByTestId("slide-navigator-select").selectOption(
  midSlide.id
);
await page.waitForURL(
  new RegExp(`/courses/${courseId}/slides/${midSlide.id}$`),
  { timeout: 10_000 }
);
await page.waitForSelector(
  "[data-testid=slide-navigator-counter]",
  { timeout: 5_000 }
);
const counterAfterDropdown = (
  await page.getByTestId("slide-navigator-counter").textContent()
)?.trim();
check(
  "counter shows the mid position",
  counterAfterDropdown ===
    `${midSlide.order + 1} / ${courseSlides.length}`
);
const headingAfterDropdown = (
  await page.getByTestId("slide-title-heading").textContent()
)?.trim();
check(
  "heading shows the dropped-to slide",
  headingAfterDropdown === midSlide.title
);

await page.screenshot({
  path: resolve(evidenceDir, "05-dropdown-jump.png"),
  fullPage: true,
});

// ─── 5. Last slide: next disabled ─────────────────────────────────
console.log("\n[5] Last slide (Siguiente disabled)");
await page.goto(
  `${baseUrl}/courses/${courseId}/slides/${lastSlide.id}`,
  { waitUntil: "domcontentloaded", timeout: 30_000 }
);
await page.waitForSelector(
  "[data-testid=slide-navigator-counter]",
  { timeout: 10_000 }
);
const lastCounter = (
  await page.getByTestId("slide-navigator-counter").textContent()
)?.trim();
check(
  "last counter shows 'N / N'",
  lastCounter === `${courseSlides.length} / ${courseSlides.length}`
);
check(
  "Siguiente disabled on last slide",
  await page.getByTestId("slide-navigator-next").isDisabled()
);
check(
  "Anterior enabled on last slide",
  !(await page.getByTestId("slide-navigator-prev").isDisabled())
);

await page.screenshot({
  path: resolve(evidenceDir, "06-last-slide.png"),
  fullPage: true,
});

// ─── 6. Dropdown options are complete and in order ────────────────
console.log("\n[6] Dropdown options");
const options = await page
  .getByTestId("slide-navigator-select")
  .locator("option")
  .allTextContents();
check(
  "dropdown has one option per slide",
  options.length === courseSlides.length
);
const firstOptionText = options[0]?.trim() ?? "";
check(
  "first option starts with '1. ' and the first title",
  firstOptionText.startsWith("1. ") &&
    firstOptionText.includes(firstSlide.title)
);
const lastOptionText = options[options.length - 1]?.trim() ?? "";
const expectedOrder = `${courseSlides.length}. `;
check(
  "last option starts with 'N. ' and the last title",
  lastOptionText.startsWith(expectedOrder) &&
    lastOptionText.includes(lastSlide.title)
);

// ─── 7. Mobile viewport — navigator still functional ──────────────
console.log("\n[7] Mobile viewport");
const mobileCtx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
});
const mobilePage = await mobileCtx.newPage();
await mobilePage.goto(
  `${baseUrl}/courses/${courseId}/slides/${midSlide.id}`,
  { waitUntil: "domcontentloaded", timeout: 30_000 }
);
await mobilePage.waitForSelector(
  "[data-testid=slide-navigator-select]",
  { timeout: 10_000 }
);
await mobilePage.screenshot({
  path: resolve(evidenceDir, "07-mobile-mid.png"),
  fullPage: true,
});
await mobilePage
  .getByTestId("slide-navigator-next")
  .click();
await mobilePage.waitForURL(
  new RegExp(
    `/courses/${courseId}/slides/${courseSlides[midSlide.order + 1].id}$`
  ),
  { timeout: 10_000 }
);
check(
  "Siguiente works on mobile viewport",
  mobilePage.url().endsWith(
    `/courses/${courseId}/slides/${courseSlides[midSlide.order + 1].id}`
  )
);
await mobilePage.screenshot({
  path: resolve(evidenceDir, "08-mobile-after-next.png"),
  fullPage: true,
});
await mobileCtx.close();

// ─── 8. Cleanup: revert the test title edit ───────────────────────
console.log("\n[8] Cleanup: revert title edit");
try {
  await page.goto(
    `${baseUrl}/courses/${courseId}/slides/${firstSlide.id}`,
    { waitUntil: "domcontentloaded", timeout: 30_000 }
  );
  await page.waitForSelector(
    "[data-testid=slide-title-edit-button]",
    { timeout: 10_000 }
  );
  await page.getByTestId("slide-title-edit-button").click();
  await page.waitForSelector(
    "[data-testid=slide-title-input]",
    { timeout: 5_000 }
  );
  await page.getByTestId("slide-title-input").fill(originalTitle);
  await page.getByTestId("slide-description-input").fill("");
  await page.getByTestId("slide-title-save-button").click();
  await page.waitForSelector(
    '[data-testid="slide-title-field"][data-state="read-only"]',
    { timeout: 10_000 }
  );
  console.log("  cleanup OK");
} catch (e) {
  console.warn(`  cleanup failed (non-fatal): ${e.message}`);
}

await ctx.close();
await browser.close();

// ─── Summary ──────────────────────────────────────────────────────
const summary = {
  courseId,
  courseName: course.name,
  slideCount: courseSlides.length,
  firstSlideId: firstSlide.id,
  midSlideId: midSlide.id,
  lastSlideId: lastSlide.id,
  errors,
  status: errors.length === 0 ? "PASS" : "FAIL",
};
writeFileSync(
  resolve(evidenceDir, "summary.json"),
  JSON.stringify(summary, null, 2)
);
console.log(`\n${summary.status}: ${errors.length} error(s)`);
if (errors.length) {
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`Screenshots written to ${evidenceDir}`);

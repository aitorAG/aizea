// @ts-check
//
// Playwright smoke test for the multi-job pipeline banner + reload
// persistence. We use Prisma directly to inject fake in-flight
// ProcessingJob rows so the banner has something to display, since
// real pipeline runs complete too quickly to observe in screenshots.
//
// The dev server must be running on http://localhost:3000 before this
// script is invoked.

import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const EVIDENCE_DIR = join(process.cwd(), ".omo", "evidence", "banner-multi-stuck");
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

function step(label) {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${label} ===`);
}

async function dump(page, label) {
  const banners = await page
    .locator('[data-testid="global-pipeline-banner"]')
    .count();
  const stack = page.locator('[data-testid="global-pipeline-banner-stack"]');
  const stackCount = await stack.getAttribute("data-count").catch(() => "0");
  console.log(
    `  [${label}] banners=${banners} stackDataCount=${stackCount}`
  );
  return { banners, stackCount };
}

async function main() {
  const db = new PrismaClient();
  // Clean any prior fixtures so the test is repeatable.
  await db.processingJob.deleteMany({
    where: { id: { startsWith: "qa-fixture-" } },
  });

  // Use the existing courses if any, otherwise create two.
  let courses = await db.course.findMany({ take: 2 });
  if (courses.length < 2) {
    const need = 2 - courses.length;
    for (let i = 0; i < need; i++) {
      const c = await db.course.create({
        data: { name: `QA Banner Course ${Date.now()}-${i}` },
      });
      courses.push(c);
    }
  }
  const [courseA, courseB] = courses;
  console.log(`  courseA=${courseA.id} courseB=${courseB.id}`);

  // Inject 2 active jobs (one per course) that are running.
  const now = new Date();
  const tenMinAgo = new Date(Date.now() - 10 * 60_000);
  await db.processingJob.create({
    data: {
      id: "qa-fixture-job-A",
      type: "segmentation",
      status: "running",
      progress: 12,
      currentStep: "Procesando páginas 1-12",
      courseId: courseA.id,
      createdAt: tenMinAgo,
      updatedAt: tenMinAgo,
    },
  });
  await db.processingJob.create({
    data: {
      id: "qa-fixture-job-B",
      type: "extraction",
      status: "running",
      progress: 47,
      currentStep: "Unidad 5/12",
      courseId: courseB.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  // Also inject a STUCK job (running for 10 min, no progress change).
  await db.processingJob.create({
    data: {
      id: "qa-fixture-job-stuck",
      type: "integration",
      status: "running",
      progress: 8,
      currentStep: "Esperando respuesta del modelo",
      courseId: courseA.id,
      createdAt: tenMinAgo,
      updatedAt: tenMinAgo,
    },
  });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await ctx.newPage();

  step("1. Navigate to home — banner should hydrate from server");
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });
  await page.waitForTimeout(3_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "01-home-with-3-banners.png"),
    fullPage: false,
  });
  const r1 = await dump(page, "home");
  console.log(
    `  Expected: 3 banners (1 per active job). Got: ${r1.banners}.`
  );

  step("2. Reload — banner should still be there (hydration persistence)");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(3_000);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "02-after-reload.png"),
    fullPage: false,
  });
  const r2 = await dump(page, "reload");
  console.log(
    `  Expected: 3 banners after reload. Got: ${r2.banners}.`
  );

  step("3. Dismiss one banner — others stay visible");
  const closeButtons = page.locator('[data-testid="banner-close"]');
  const beforeDismiss = await closeButtons.count();
  console.log(`  close buttons before dismiss: ${beforeDismiss}`);
  if (beforeDismiss > 0) {
    await closeButtons.first().click();
    await page.waitForTimeout(500);
  }
  await page.screenshot({
    path: join(EVIDENCE_DIR, "03-after-dismiss.png"),
    fullPage: false,
  });
  const r3 = await dump(page, "after-dismiss");
  console.log(
    `  Expected: 2 banners remaining. Got: ${r3.banners}.`
  );

  step("4. The stuck banner should show the Reintentar button");
  const retryButtons = await page
    .locator('[data-testid="banner-retry"]')
    .count();
  console.log(`  Reintentar buttons visible: ${retryButtons}`);
  await page.screenshot({
    path: join(EVIDENCE_DIR, "04-stuck-with-retry.png"),
    fullPage: false,
  });

  step("5. Clean up");
  await db.processingJob.deleteMany({
    where: { id: { startsWith: "qa-fixture-" } },
  });
  await db.$disconnect();

  const summary = {
    step1_home: r1.banners,
    step2_reload: r2.banners,
    step3_after_dismiss: r3.banners,
    retry_buttons_visible: retryButtons,
  };
  console.log("\nFINAL SUMMARY:", JSON.stringify(summary, null, 2));
  await browser.close();
  if (r1.banners !== 3 || r2.banners !== 3 || r3.banners !== 2) {
    console.error("UNEXPECTED banner counts");
    process.exit(2);
  }
}

main().catch((err) => {
  console.error("Playwright test failed:", err);
  process.exit(1);
});

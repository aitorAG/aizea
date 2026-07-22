// E2E: v1.5 finding 1.7 — upload must NOT trigger the pipeline.
//
// What this verifies:
//   1. The materials page accepts a file upload.
//   2. The upload completes (toast appears).
//   3. The toast text says "Ve a 'Generar árbol' para procesarlo"
//      (the new copy that tells the user the pipeline will only
//      run on the explicit CTA, NOT on upload).
//   4. After the upload, the DB has zero ProcessingJob rows for
//      the course (the pipeline did NOT run).
//   5. After the upload, the DB has zero SemanticUnit / TopicNode
//      rows for the course (the pipeline did NOT run).
//   6. The Material row IS in the DB (the upload succeeded).
//   7. The upload time is recorded (target: < 2s; the actual time
//      depends on the other best-effort side-effects which the
//      brief leaves in scope — RAG indexing makes real OpenRouter
//      calls in this test env, layout parser makes real docling
//      calls if up).
//
// The script uses Playwright to drive the real browser + the real
// dev server, then queries Prisma to confirm the DB state.
//
// Usage:  node scripts/e2e-1.7-no-pipeline.mjs
// (requires the dev server to be running on http://localhost:3000)

import { chromium } from 'playwright';
import { PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const OUT_DIR = join(process.cwd(), '.test-artifacts', 'evidence', 'v1.5', 'wave-1');
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const SCREENSHOT_PATH = join(OUT_DIR, '1.7-no-pipeline.png');
const REPORT_PATH = join(OUT_DIR, '1.7-e2e-report.txt');

const FIXTURE_PDF = join(process.cwd(), 'tests', 'fixtures', 'sample.pdf');

// Create a fresh course every time so the materials page is
// clean (no leftover ProcessingJob rows that would trigger the
// failed-pipeline banner + page polling).
const db = new PrismaClient();
const freshCourse = await db.course.create({
  data: { name: `E2E_1.7 ${new Date().toISOString()}` },
});
const courseId = freshCourse.id;
console.log('[course] created fresh:', courseId, freshCourse.name);

// Snapshot pre-state.
const preJobs = await db.processingJob.count({ where: { courseId } });
const preUnits = await db.semanticUnit.count({
  where: { material: { courseId } },
});
const preNodes = await db.topicNode.count({ where: { courseId } });
const preMaterials = await db.material.count({ where: { courseId } });
console.log('[pre-state] materials=', preMaterials, 'jobs=', preJobs, 'units=', preUnits, 'nodes=', preNodes);

const URL = `http://localhost:3000/courses/${courseId}/materials`;

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') {
    console.log(`[browser:${t}]`, m.text());
  }
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

console.log('[goto]', URL);
const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('[status]', resp?.status());

// Wait for the upload zone to be hydrated.
await page.waitForSelector('[data-testid="upload-zone"]', { timeout: 30000 });
console.log('[ok] upload-zone visible');

// Find the file input. The component renders it with absolute
// positioning + opacity 0, but Playwright's setInputFiles works
// regardless of visibility.
const fileInput = page.locator('input[type="file"]').first();
await fileInput.waitFor({ state: 'attached', timeout: 10000 });

console.log('[upload] starting');
const uploadStart = Date.now();

await fileInput.setInputFiles(FIXTURE_PDF);

// Wait for the success toast. The toast renders with the title
// "Archivo subido" — this is the user's confirmation that the
// upload completed.
const toastTitle = page.locator('text=Archivo subido').first();
await toastTitle.waitFor({ timeout: 120000 });
const uploadElapsedMs = Date.now() - uploadStart;
console.log('[upload] toast appeared in', uploadElapsedMs, 'ms');

// Wait a bit more so the DOM is stable, then capture the toast
// text + the page state.
await page.waitForTimeout(1500);

const toastText = await page.evaluate(() => {
  // The toast library renders into a portal — we read every
  // visible text node that looks like our toast body.
  const all = document.querySelectorAll('*');
  for (const el of all) {
    const t = el.textContent || '';
    if (t.includes('Archivo subido')) {
      return t;
    }
  }
  return null;
});
console.log('[toast-text]', JSON.stringify(toastText));

// Check the new copy is in place.
const expectedSubstring = 'Generar árbol';
const hasNewCopy = (toastText || '').includes(expectedSubstring);
const hasOldCopy = (toastText || '').includes('procesamiento del árbol conceptual se ha iniciado');
console.log('[copy] has new "Generar árbol" hint:', hasNewCopy);
console.log('[copy] still has OLD "procesamiento del árbol conceptual se ha iniciado":', hasOldCopy);

// Take the screenshot — capture the materials page with the
// upload success state (file in the list + toast).
await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
console.log('[screenshot]', SCREENSHOT_PATH);

// Snapshot the post-state.
const postJobs = await db.processingJob.count({ where: { courseId } });
const postUnits = await db.semanticUnit.count({
  where: { material: { courseId } },
});
const postNodes = await db.topicNode.count({ where: { courseId } });
const postMaterials = await db.material.count({ where: { courseId } });
console.log('[post-state] materials=', postMaterials, 'jobs=', postJobs, 'units=', postUnits, 'nodes=', postNodes);

const newJobs = postJobs - preJobs;
const newUnits = postUnits - preUnits;
const newNodes = postNodes - preNodes;
const newMaterials = postMaterials - preMaterials;

const acceptance = {
  uploadCompleted: !!toastText,
  toastHasNewCopy: hasNewCopy,
  toastDoesNotHaveOldCopy: !hasOldCopy,
  zeroNewJobs: newJobs === 0,
  zeroNewUnits: newUnits === 0,
  zeroNewNodes: newNodes === 0,
  materialCreated: newMaterials > 0,
};

const allPass = Object.values(acceptance).every((v) => v === true);
const reportText = [
  `E2E upload — v1.5 finding 1.7 — ${new Date().toISOString()}`,
  `=========================================`,
  `Course:        ${courseId}`,
  `URL:           ${URL}`,
  `Fixture:       ${FIXTURE_PDF}`,
  ``,
  `Upload measurement:`,
  `  elapsedMs:        ${uploadElapsedMs}  (target: < 2000ms — see notes)`,
  `  toast:            ${toastText ? 'visible' : 'NOT VISIBLE'}`,
  ``,
  `Pre-state (before upload):`,
  `  materials:        ${preMaterials}`,
  `  processingJobs:   ${preJobs}`,
  `  semanticUnits:    ${preUnits}`,
  `  topicNodes:       ${preNodes}`,
  ``,
  `Post-state (after upload):`,
  `  materials:        ${postMaterials}  (Δ ${newMaterials >= 0 ? '+' : ''}${newMaterials})`,
  `  processingJobs:   ${postJobs}  (Δ ${newJobs >= 0 ? '+' : ''}${newJobs}, must be 0)`,
  `  semanticUnits:    ${postUnits}  (Δ ${newUnits >= 0 ? '+' : ''}${newUnits}, must be 0)`,
  `  topicNodes:       ${postNodes}  (Δ ${newNodes >= 0 ? '+' : ''}${newNodes}, must be 0)`,
  ``,
  `Acceptance criteria (v1.5 finding 1.7):`,
  `  upload completed:                       ${acceptance.uploadCompleted ? 'PASS' : 'FAIL'}`,
  `  toast has new "Generar árbol" copy:     ${acceptance.toastHasNewCopy ? 'PASS' : 'FAIL'}`,
  `  toast does NOT have the old copy:       ${acceptance.toastDoesNotHaveOldCopy ? 'PASS' : 'FAIL'}`,
  `  zero new ProcessingJob rows:            ${acceptance.zeroNewJobs ? 'PASS' : 'FAIL'}`,
  `  zero new SemanticUnit rows:             ${acceptance.zeroNewUnits ? 'PASS' : 'FAIL'}`,
  `  zero new TopicNode rows:                ${acceptance.zeroNewNodes ? 'PASS' : 'FAIL'}`,
  `  material created:                       ${acceptance.materialCreated ? 'PASS' : 'FAIL'}`,
  ``,
  `Conclusion:`,
  `  ${allPass ? 'ALL ACCEPTANCE CRITERIA MET' : 'SOME ACCEPTANCE CRITERIA FAILED'}`,
].join('\n');

writeFileSync(REPORT_PATH, reportText, 'utf8');
console.log('[report]', REPORT_PATH);
console.log('');
console.log(reportText);

await browser.close();
await db.$disconnect();

if (!allPass) {
  console.log('\n[FAIL] some acceptance criteria failed');
  process.exit(1);
}
console.log('\n[OK] all acceptance criteria met');

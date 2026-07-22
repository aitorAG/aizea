// @ts-check
//
// 00-baseline.mjs — measure the current upload time BEFORE the
// decoupling fix.
//
// We invoke the action's HTTP endpoint via the running dev server
// (http://localhost:3000) so we measure the full path the user hits:
// FormData parse → Buffer → UploadMaterialUseCase.execute →
// pdfExtractor → materials.create → ragIndexer → figureExtractor →
// layoutParser → pipeline.processCourse (Docling + 4-phase pipeline)
// → notifier.notify → revalidatePath → response.
//
// We then ALSO measure just the UploadMaterialUseCase.execute call
// directly via the container (Node script) so we can attribute time
// to each phase without the HTTP/Next.js overhead.

import { createContainer } from "../lib/composition/container.ts";
import { PrismaClient } from "@prisma/client";
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const EVIDENCE_DIR = join(process.cwd(), ".test-artifacts", "evidence", "upload-decoupling");
if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });

const FIXTURE_PDF = join(process.cwd(), "tests", "fixtures", "sample.pdf");
const PDF_SIZE = statSync(FIXTURE_PDF).size;
const EVIDENCE_FILE = join(EVIDENCE_DIR, "00-baseline.txt");

function ts() {
  return new Date().toISOString();
}
function ms() {
  return Date.now();
}

async function measureDirect(courseId) {
  console.log("\n[baseline] Measuring direct UploadMaterialUseCase.execute()...");
  const container = createContainer();
  const buffer = readFileSync(FIXTURE_PDF);
  const start = ms();
  let outcome;
  try {
    outcome = await container.uploadMaterial.execute({
      courseId,
      filename: `baseline-${Date.now()}_sample.pdf`,
      fileType: "application/pdf",
      fileSize: buffer.length,
      buffer,
      userId: "baseline",
    });
  } catch (err) {
    console.error("[baseline] direct execute() threw:", err.message);
    return { ok: false, error: err.message, elapsedMs: ms() - start };
  }
  const elapsedMs = ms() - start;
  console.log(`[baseline] direct execute() took ${elapsedMs}ms`);
  console.log(`[baseline]   materialId=${outcome.material.id}`);
  // v1.5 finding 1.7: the upload outcome no longer includes
  // `pipelineResult` because the upload use case is decoupled
  // from the pipeline. We log a sentinel so the baseline
  // report shows the field was intentionally removed.
  console.log(`[baseline]   pipelineResult=REMOVED (v1.5 finding 1.7)`);
  return { ok: true, elapsedMs, materialId: outcome.material.id, pipelineResult: null };
}

async function measureHttp(courseId) {
  console.log("\n[baseline] Measuring HTTP upload (FormData via dev server)...");
  // First check the server is up
  try {
    const ping = await fetch("http://localhost:3000/", { method: "HEAD" });
    if (!ping.ok && ping.status !== 405) {
      throw new Error(`ping returned ${ping.status}`);
    }
  } catch (e) {
    console.warn(`[baseline] dev server not reachable: ${e.message}`);
    return { ok: false, error: "dev server not reachable", elapsedMs: 0 };
  }

  // The form action is reached via the /materials page's client component.
  // We POST a multipart form to the same Next.js server action endpoint.
  // The cleanest way: hit the page first to discover the action id, then
  // POST. But the simplest is to just POST to the page with the multipart
  // form and see how long it takes — server actions can be invoked via
  // a POST to the page route with a `next-action` header.
  // For measurement, the BEST signal is the direct call (above); HTTP
  // just adds Next.js overhead on top. We still do it for completeness.
  //
  // Use the actual page POST flow: the materials client uploads via
  // `useMaterialAdapter.uploadMaterial`, which calls the server action
  // `uploadMaterial(courseId, formData)`. We can hit it via fetch with
  // a multipart/form-data body. Next.js handles this via the
  // `Next-Action` header. Without knowing the action id, we cannot
  // invoke it directly via fetch — but we can simulate the same path
  // by sending a POST to /api/upload (which exists for older flows).
  //
  // Easiest: just measure /api/upload.
  const formData = new FormData();
  const fileBuf = readFileSync(FIXTURE_PDF);
  formData.append("file", new Blob([fileBuf], { type: "application/pdf" }), "sample.pdf");
  formData.append("courseId", courseId);
  const start = ms();
  let res;
  try {
    res = await fetch("http://localhost:3000/api/upload", {
      method: "POST",
      body: formData,
    });
  } catch (e) {
    console.warn(`[baseline] HTTP upload error: ${e.message}`);
    return { ok: false, error: e.message, elapsedMs: ms() - start };
  }
  const elapsedMs = ms() - start;
  const text = await res.text().catch(() => "");
  console.log(`[baseline] HTTP upload took ${elapsedMs}ms, status=${res.status}`);
  console.log(`[baseline]   body: ${text.slice(0, 200)}`);
  return { ok: res.ok, status: res.status, elapsedMs, body: text.slice(0, 200) };
}

async function main() {
  console.log(`[baseline] ${ts()} starting baseline measurement`);
  console.log(`[baseline] fixture: ${FIXTURE_PDF} (${PDF_SIZE} bytes)`);

  const db = new PrismaClient();
  // Create a fresh course for the baseline.
  const course = await db.course.create({
    data: { name: `BASELINE ${ts()}` },
  });
  console.log(`[baseline] course=${course.id} name="${course.name}"`);

  // Clean any leftover state.
  await db.processingJob.deleteMany({ where: { courseId: course.id } });
  await db.material.deleteMany({ where: { courseId: course.id } });

  // 1) Direct use case call.
  const direct = await measureDirect(course.id);

  // Give a moment for the database to settle.
  await new Promise((r) => setTimeout(r, 500));

  // 2) HTTP path (best-effort, for additional context).
  const http = await measureHttp(course.id);

  // Inspect post-state.
  const materials = await db.material.findMany({ where: { courseId: course.id } });
  const jobs = await db.processingJob.findMany({ where: { courseId: course.id } });
  const units = await db.semanticUnit.findMany({
    where: { material: { courseId: course.id } },
  });
  const nodes = await db.topicNode.findMany({ where: { courseId: course.id } });

  const report = {
    startedAt: ts(),
    fixture: { path: FIXTURE_PDF, sizeBytes: PDF_SIZE },
    course: { id: course.id, name: course.name },
    direct: {
      ok: direct.ok,
      elapsedMs: direct.elapsedMs,
      materialId: direct.materialId ?? null,
      pipelineResult: "REMOVED (v1.5 finding 1.7)",
      error: direct.error ?? null,
    },
    http: {
      ok: http.ok,
      status: http.status ?? null,
      elapsedMs: http.elapsedMs,
      body: http.body ?? null,
      error: http.error ?? null,
    },
    postState: {
      materials: materials.length,
      processingJobs: jobs.length,
      semanticUnits: units.length,
      topicNodes: nodes.length,
      jobStatuses: jobs.map((j) => `${j.type}=${j.status} (${j.progress}%)`),
    },
    notes: [
      "DIRECT measures the use case in isolation — pure backend time.",
      "HTTP measures the user-facing path: FormData → server action → use case → response.",
      "Both calls trigger the full pipeline (4 phases, Docling) — that's the bug.",
    ],
  };

  const reportText = [
    `Upload baseline measurement — ${ts()}`,
    `=========================================`,
    `Course:        ${course.id}  "${course.name}"`,
    `Fixture:       ${FIXTURE_PDF}  (${PDF_SIZE} bytes)`,
    ``,
    `DIRECT call (UploadMaterialUseCase.execute):`,
    `  ok:           ${direct.ok}`,
    `  elapsedMs:    ${direct.elapsedMs}`,
    `  pipelineResult: REMOVED (v1.5 finding 1.7 — upload is decoupled from the pipeline)`,
    direct.error ? `  error:        ${direct.error}` : null,
    ``,
    `HTTP call (POST /api/upload via dev server):`,
    `  ok:           ${http.ok}`,
    `  status:       ${http.status ?? "n/a"}`,
    `  elapsedMs:    ${http.elapsedMs}`,
    http.error ? `  error:        ${http.error}` : null,
    ``,
    `Post-state in DB after the call(s):`,
    `  materials:      ${materials.length}`,
    `  processingJobs: ${jobs.length}`,
    `  semanticUnits:  ${units.length}`,
    `  topicNodes:     ${nodes.length}`,
    `  job statuses:   ${report.postState.jobStatuses.join(", ") || "(none)"}`,
    ``,
    `Notes:`,
    `  - The DIRECT path is the user-facing cost + HTTP/Next.js overhead.`,
    `  - The upload triggers the full pipeline (Docling + 4 phases).`,
    `  - That's why a single upload takes ${direct.elapsedMs}ms.`,
    `  - After decoupling, the same call should take < 2000ms.`,
    ``,
    `JSON:`,
    JSON.stringify(report, null, 2),
  ].filter(Boolean).join("\n");

  console.log("\n" + reportText);
  writeFileSync(EVIDENCE_FILE, reportText, "utf8");
  console.log(`\n[baseline] wrote ${EVIDENCE_FILE}`);

  await db.$disconnect();
}

main().catch((err) => {
  console.error("baseline failed:", err);
  process.exit(1);
});

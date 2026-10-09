"use server";

/**
 * Slide-generation job lifecycle actions (v0.11.0).
 *
 * Slide generation runs on the client through the in-process
 * `SlideGenerationQueue`, so it never used to write `ProcessingJob` rows and
 * therefore never appeared in the Jobs tab. These actions let the client
 * open/update/close a `ProcessingJob` row of type "slide-generation" so the
 * user gets the same persistent visibility the tree pipeline already has.
 *
 * The Jobs panel (JobsPanelContent) and `findRecentWithCourseNames` are
 * type-agnostic (they only exclude the internal "pipeline-run" meta-row), and
 * the "slide-generation" label/icon already exist in job-labels.ts — so no UI
 * or schema change is required beyond writing these rows.
 */

import { container } from "@/lib/composition/container";

/** Job type recognised by the Jobs panel label map. */
const SLIDE_JOB_TYPE = "slide-generation";
const PPT_EXPORT_JOB_TYPE = "ppt-export";

/**
 * Open a slide-generation job. Returns the generated job id the client keeps
 * and threads through `updateSlideJobAction` / `finishSlideJobAction`.
 */
export async function startSlideJobAction(
  courseId: string,
  total: number,
  initialStep = "Generando diapositivas"
): Promise<{ jobId: string }> {
  const jobId = `pj-slide-generation-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  await container.processingJobs.create({
    id: jobId,
    type: SLIDE_JOB_TYPE,
    status: "running",
    progress: 0,
    total: Math.max(1, total),
    currentStep: initialStep,
    error: null,
    courseId,
    materialId: null,
  });

  return { jobId };
}

/** Open a persistent job for PPT generation. */
export async function startPptExportJobAction(
  courseId: string,
  total: number
): Promise<{ jobId: string }> {
  const jobId = `pj-ppt-export-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  await container.processingJobs.create({
    id: jobId,
    type: PPT_EXPORT_JOB_TYPE,
    status: "running",
    progress: 0,
    total: Math.max(1, total),
    currentStep: "Preparando presentación PowerPoint",
    error: null,
    courseId,
    materialId: null,
  });

  return { jobId };
}

/** Update PPT export progress (best effort for a visibility-only job). */
export async function updatePptExportJobAction(
  jobId: string,
  progress: number,
  total: number
): Promise<void> {
  try {
    await container.processingJobs.update(jobId, {
      progress,
      total: Math.max(1, total),
      currentStep: `Preparando diapositiva ${progress}/${total}`,
    });
  } catch {
    // The export result remains authoritative if the visibility row disappears.
  }
}

/** Close PPT export job after generation. */
export async function finishPptExportJobAction(
  jobId: string,
  status: "completed" | "failed",
  total: number,
  error?: string
): Promise<void> {
  try {
    await container.processingJobs.update(jobId, {
      status,
      progress: status === "completed" ? Math.max(1, total) : undefined,
      total: Math.max(1, total),
      currentStep:
        status === "completed"
          ? "Presentación PowerPoint preparada"
          : "Exportación PowerPoint fallida",
      error: error ?? null,
    });
  } catch {
    // Terminal visibility is best effort and must not mask the export error.
  }
}

/** Update progress (best-effort — never throws to the caller's flow). */
export async function updateSlideJobAction(
  jobId: string,
  progress: number,
  currentStep: string
): Promise<void> {
  try {
    await container.processingJobs.update(jobId, { progress, currentStep });
  } catch {
    // A missing/expired job row must not break the client generation flow.
  }
}

/** Close the job with a terminal status. */
export async function finishSlideJobAction(
  jobId: string,
  status: "completed" | "failed",
  total: number,
  error?: string
): Promise<void> {
  try {
    await container.processingJobs.update(jobId, {
      status,
      progress: status === "completed" ? Math.max(1, total) : undefined,
      currentStep:
        status === "completed"
          ? "Diapositivas generadas"
          : "Generación finalizada con errores",
      error: error ?? null,
    });
  } catch {
    // Ignore — terminal update is best-effort visibility, not correctness.
  }
}

/**
 * v0.12.0 (RC3) — Sincroniza el estado de una diapositiva en la BD.
 * La cola de generación invoca esto tras cada transición del store Zustand,
 * para que `Slide.status` sea la fuente de verdad persistente y sobreviva
 * a la navegación.
 */
export async function updateSlideStatusAction(
  slideId: string,
  status: string
): Promise<void> {
  try {
    await container.slides.update(slideId, { status });
  } catch {
    // Best-effort: si falla la escritura, el store Zustand sigue siendo correcto en memoria.
  }
}

/**
 * v0.12.0 (RC3) — Lee los estados de generación de todas las diapositivas de un curso.
 * El cliente invoca esto al montar para recuperar el progreso tras navegación.
 * Retorna un mapa slideId → status (solo slides con status no-idle).
 */
export async function getSlideStatusesAction(
  courseId: string
): Promise<Record<string, string>> {
  const allSlides = await container.slides.findAll();
  const slides = allSlides.filter((s) => s.courseId === courseId);
  const result: Record<string, string> = {};
  for (const slide of slides) {
    if (slide.status && slide.status !== "idle") {
      result[slide.id] = slide.status;
    }
  }
  return result;
}

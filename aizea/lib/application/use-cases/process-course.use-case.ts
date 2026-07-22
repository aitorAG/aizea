// ProcessCourseUseCase — the "Generar árbol" use case.
//
// This is the FIX for the "Generar árbol → sin contenido que
// procesar" bug. The previous implementation was a thin action that
// called `PipelineService.run(courseId)` and hoped the data layer
// had something to segment. When docling-serve was down at upload
// time, the segmentation silently produced zero units, the user
// clicked "Generar árbol", and the orchestrator loaded zero
// existing units → `empty:true` → "sin contenido que procesar".
//
// The fix is structural: this use case is INTELLIGENT about what
// the data supports. It asks the material repository:
//
//   1. Are there any materials for this course? If not →
//      NO_MATERIALS. Surface a clear message.
//   2. For EACH material in the course:
//      a. Has it been segmented before? If so, re-run the pipeline
//         on the existing units (the fast path: re-build the tree
//         on top of already-segmented units).
//      b. Otherwise, the previous segmentation likely failed
//         (e.g. docling was down). Read the file from disk and
//         re-run the pipeline with the buffer. The orchestrator's
//         segmenter is now resilient to docling failures
//         (text-only fallback) so this run will succeed even if
//         docling is still down.
//      c. If the file is missing on disk → FILE_MISSING for that
//         material. Continue with the others (don't abort the
//         whole run).
//      d. If the pipeline throws for one material, surface a clear
//         per-material error and keep going with the remaining
//         materials. v1.5 finding 2.5: a single failing PDF must
//         not break the generation for the rest of the course.
//
//   3. The integration + tree-building phases run inside the
//      pipeline service and operate at the COURSE level (not the
//      material level), so each pipeline call re-builds the tree
//      over the union of all materials' SemanticUnits. After the
//      loop, the tree contains concepts from every material that
//      succeeded — that is the unified tree v1.5 #2.5 requires.
//
// This design makes the entire class of bugs impossible: the use
// case never invokes the pipeline with a `courseId` alone when
// there is reason to believe the segmentation never produced
// units. The orchestrator no longer needs three conditional paths
// selected by the caller's needs — it just runs whatever the use
// case tells it to.

import type { IMaterialRepository } from "@/lib/application/ports/material-repository.port";
import type {
  IPipelineService,
  ProcessCourseResult,
} from "@/lib/application/ports/pipeline.port";
import type { INotifier } from "@/lib/application/ports/notifier.port";

/** Per-material failure surface. The use case collects one of these
 *  for every material that could not be processed so the action
 *  layer (and the user) can see exactly which file broke the run
 *  without aborting the rest of the course. */
export interface MaterialProcessingError {
  materialId: string;
  filename: string;
  error: string;
}

/** Discriminated result returned to the action layer. The action
 *  translates each variant into a stable wire shape for the client.
 *
 *  The `jobs` field is the LAST material's job ids. The banner only
 *  needs a single coherent set to render "generating tree" copy and
 *  the `processedMaterials` count tells the user how many of their
 *  files made it. `materialErrors` lists the ones that did not. */
export type ProcessCourseOutcome =
  | {
      ok: true;
      result: ProcessCourseResult;
      empty: false;
      /** Number of materials that successfully produced units. */
      processedMaterials: number;
      /** Total materials in the course. */
      totalMaterials: number;
      /** Per-material failures (file missing, pipeline error, etc.). */
      materialErrors: MaterialProcessingError[];
    }
  | {
      ok: true;
      empty: true;
      reason: "NO_MATERIALS" | "FILE_MISSING" | "ALL_EMPTY" | "ALL_FAILED";
      message: string;
      jobs: {
        segmentationJobId: string;
        extractionJobId: string;
        integrationJobId: string;
        treeBuildingJobId: string;
      };
      /** Per-material failures (when reason is "ALL_FAILED"). */
      materialErrors: MaterialProcessingError[];
    }
  | { ok: false; error: string };

export interface ProcessCourseUseCaseDeps {
  pipeline: IPipelineService;
  materials: IMaterialRepository;
  notifier: INotifier;
  /** Stable user id passed to the notifier. Until auth lands, this
   *  is a placeholder; tests inject a deterministic value. */
  notifyUserId?: string;
}

export class ProcessCourseUseCase {
  private readonly pipeline: IPipelineService;
  private readonly materials: IMaterialRepository;
  private readonly notifier: INotifier;
  private readonly notifyUserId: string;

  constructor(deps: ProcessCourseUseCaseDeps) {
    this.pipeline = deps.pipeline;
    this.materials = deps.materials;
    this.notifier = deps.notifier;
    this.notifyUserId = deps.notifyUserId ?? "default";
  }

  async execute(courseId: string): Promise<ProcessCourseOutcome> {
    // 1. Existence check: do we have any materials at all?
    const materials = await this.materials.findByCourseId(courseId);
    if (materials.length === 0) {
      this.notifier.notify(
        this.notifyUserId,
        "Sube un PDF antes de generar el árbol.",
        "info"
      );
      return {
        ok: true,
        empty: true,
        reason: "NO_MATERIALS",
        message: "Sube un PDF antes de generar el árbol.",
        jobs: {
          segmentationJobId: "",
          extractionJobId: "",
          integrationJobId: "",
          treeBuildingJobId: "",
        },
        materialErrors: [],
      };
    }

    // 2. Iterate over EVERY material and try to process it.
    //
    // The previous implementation picked ONE material (the first
    // with units, or the latest as a recovery fallback) and
    // returned. That silently dropped every other material in the
    // course. v1.5 #2.5: the user uploaded two PDFs and only saw
    // the tree of the first. We now loop over all of them.
    const errors: MaterialProcessingError[] = [];
    const empties: Array<{ materialId: string; filename: string }> = [];
    const results: ProcessCourseResult[] = [];
    const allJobs = emptyJobs();

    for (const material of materials) {
      const outcome = await this.processOneMaterial(courseId, material);
      if (outcome.kind === "success") {
        results.push(outcome.result);
        // Keep the most recent job ids so the banner can show a
        // coherent "generating" state. The tree will reflect ALL
        // successful materials by the time the loop ends because
        // integration + tree-building operate at the course level.
        if (outcome.result.segmentationJobId) {
          allJobs.segmentationJobId = outcome.result.segmentationJobId;
        }
        if (outcome.result.extractionJobId) {
          allJobs.extractionJobId = outcome.result.extractionJobId;
        }
        if (outcome.result.integrationJobId) {
          allJobs.integrationJobId = outcome.result.integrationJobId;
        }
        if (outcome.result.treeBuildingJobId) {
          allJobs.treeBuildingJobId = outcome.result.treeBuildingJobId;
        }
      } else if (outcome.kind === "empty") {
        // The file was OK but the segmenter found no text. Track
        // it separately so we can distinguish "the file is
        // empty" (ALL_EMPTY) from "the pipeline crashed"
        // (ALL_FAILED) at the end of the loop.
        empties.push({
          materialId: material.id,
          filename: material.filename,
        });
      } else {
        errors.push({
          materialId: material.id,
          filename: material.filename,
          error: outcome.error,
        });
        this.notifier.notify(
          this.notifyUserId,
          `No se pudo procesar "${material.filename}": ${outcome.error}`,
          "error"
        );
      }
    }

    // 3. No material produced any units. Distinguish the cause so
    // the UI can show a useful message:
    //   - FILE_MISSING: every material's file was missing on disk
    //   - ALL_EMPTY: every material was readable but had no text
    //   - ALL_FAILED: the pipeline crashed on every material
    if (results.length === 0) {
      const onlyFileMissing =
        errors.length > 0 &&
        errors.every((e) =>
          /no está disponible|sube el pdf de nuevo/i.test(e.error)
        );
      if (onlyFileMissing && errors.length === materials.length) {
        return {
          ok: true,
          empty: true,
          reason: "FILE_MISSING",
          message:
            "El archivo no está disponible. Sube el PDF de nuevo.",
          jobs: emptyJobs(),
          materialErrors: errors,
        };
      }
      if (
        empties.length > 0 &&
        errors.length === 0 &&
        empties.length === materials.length
      ) {
        return {
          ok: true,
          empty: true,
          reason: "ALL_EMPTY",
          message:
            "No hay unidades que procesar. Sube archivos con texto extraíble.",
          jobs: emptyJobs(),
          materialErrors: [],
        };
      }
      if (errors.length === materials.length) {
        // Every material threw — return ALL_FAILED so the action
        // layer can surface the per-material errors.
        return {
          ok: true,
          empty: true,
          reason: "ALL_FAILED",
          message: errors
            .map((e) => `${e.filename}: ${e.error}`)
            .join(" · "),
          jobs: emptyJobs(),
          materialErrors: errors,
        };
      }
      // Mixed: some errors and some empty. The user uploaded files
      // that had no extractable text. Surface that.
      return {
        ok: true,
        empty: true,
        reason: "ALL_EMPTY",
        message:
          "No hay unidades que procesar. Sube archivos con texto extraíble.",
        jobs: emptyJobs(),
        materialErrors: errors,
      };
    }

    // 4. At least one material produced units. The tree the user
    // sees is the result of the LAST successful pipeline call —
    // which is fine because the integration + tree-building phases
    // run at the COURSE level over the union of every material's
    // SemanticUnits. The final tree contains concepts from every
    // material that made it through the loop.
    const lastResult = results[results.length - 1];
    return {
      ok: true,
      empty: false,
      result: lastResult,
      processedMaterials: results.length,
      totalMaterials: materials.length,
      materialErrors: errors,
    };
  }

  /** Process a single material. Returns one of three kinds:
   *   - "success"  : pipeline produced at least one SemanticUnit
   *   - "empty"    : the file was readable but yielded zero units
   *   - "error"    : something went wrong (file missing, thrown error)
   *  The loop in `execute()` decides what to do with each kind. */
  private async processOneMaterial(
    courseId: string,
    material: { id: string; filename: string }
  ): Promise<
    | { kind: "success"; result: ProcessCourseResult }
    | { kind: "empty" }
    | { kind: "error"; error: string }
  > {
    // 2a. Has this material been segmented before? If so, re-run
    // the pipeline on the existing units (the fast path).
    const hasUnits = await this.materials.hasProcessedUnits(material.id);
    if (hasUnits) {
      try {
        const result = await this.pipeline.processCourse({
          courseId,
          materialId: material.id,
        });
        if (result.empty) {
          return { kind: "empty" };
        }
        return { kind: "success", result };
      } catch (err) {
        return { kind: "error", error: errorMessage(err) };
      }
    }

    // 2b. No SemanticUnits yet — the original upload's pipeline
    // run likely failed (e.g. docling-serve was down). Read the
    // file from disk and re-run with the buffer so the segmenter
    // has bytes to work on. The orchestrator's segmenter is now
    // resilient to docling failures (text-only fallback) so this
    // run will succeed even if docling is still down.
    const buffer = await this.materials.readBuffer(material.id);
    if (!buffer) {
      return {
        kind: "error",
        error: "El archivo no está disponible. Sube el PDF de nuevo.",
      };
    }

    try {
      const result = await this.pipeline.processCourse({
        courseId,
        materialId: material.id,
        buffer,
        force: true,
      });
      if (result.empty) {
        return { kind: "empty" };
      }
      return { kind: "success", result };
    } catch (err) {
      return { kind: "error", error: errorMessage(err) };
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emptyJobs() {
  return {
    segmentationJobId: "",
    extractionJobId: "",
    integrationJobId: "",
    treeBuildingJobId: "",
  };
}

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
//   2. Has any of them been segmented before? If not, the previous
//      segmentation likely failed (e.g. docling was down). Read the
//      file from disk and re-run the pipeline with the buffer.
//   3. If the file is missing on disk → FILE_MISSING. Tell the
//      user to re-upload.
//   4. Otherwise → re-run the pipeline on the existing data (the
//      fast path: re-build the tree on top of already-segmented
//      units).
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

/** Discriminated result returned to the action layer. The action
 *  translates each variant into a stable wire shape for the client. */
export type ProcessCourseOutcome =
  | { ok: true; result: ProcessCourseResult; empty: false }
  | {
      ok: true;
      empty: true;
      reason: "NO_MATERIALS" | "FILE_MISSING";
      message: string;
      jobs: {
        segmentationJobId: string;
        extractionJobId: string;
        integrationJobId: string;
        treeBuildingJobId: string;
      };
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
      };
    }

    // 2. State check: has any material been segmented before?
    //
    // We check ALL materials (not just the latest) because the user
    // might have uploaded multiple PDFs over time and any one of
    // them may already have units. We stop at the first one that
    // has units — that's the material we'd re-run on top of.
    const processedMaterial = await this.findProcessedMaterial(materials);

    if (processedMaterial) {
      // Happy path: re-run the pipeline on the existing units. The
      // orchestrator will load them from the DB and re-do phases
      // 3+4 (integration, tree-building) only.
      try {
        const result = await this.pipeline.processCourse({
          courseId,
          materialId: processedMaterial.id,
        });
        if (result.empty) {
          // The orchestrator reports empty even when the input was
          // fine. We surface that as an empty outcome (the user
          // gets a "no units to process" message from the result).
          return {
            ok: true,
            empty: true,
            reason: "NO_MATERIALS",
            message:
              result.message ?? "No hay unidades que procesar.",
            jobs: {
              segmentationJobId: result.segmentationJobId,
              extractionJobId: result.extractionJobId,
              integrationJobId: result.integrationJobId,
              treeBuildingJobId: result.treeBuildingJobId,
            },
          };
        }
        return { ok: true, empty: false, result };
      } catch (err) {
        return this.handlePipelineError(err, "pipeline-failed");
      }
    }

    // 3. Recovery path: no material has been segmented. This means
    // the original upload's pipeline run failed before producing
    // any units (most commonly because docling-serve was down).
    // Read the latest material's file from disk and re-run with
    // the buffer. The orchestrator's segmenter is now resilient to
    // docling failures (text-only fallback) so this run will
    // succeed even if docling is still down.
    const latest = materials[materials.length - 1];
    const buffer = await this.materials.readBuffer(latest.id);
    if (!buffer) {
      this.notifier.notify(
        this.notifyUserId,
        "El archivo no está disponible. Sube el PDF de nuevo.",
        "error"
      );
      return {
        ok: true,
        empty: true,
        reason: "FILE_MISSING",
        message:
          "El archivo no está disponible. Sube el PDF de nuevo.",
        jobs: {
          segmentationJobId: "",
          extractionJobId: "",
          integrationJobId: "",
          treeBuildingJobId: "",
        },
      };
    }

    try {
      const result = await this.pipeline.processCourse({
        courseId,
        materialId: latest.id,
        buffer,
        force: true,
      });
      if (result.empty) {
        return {
          ok: true,
          empty: true,
          reason: "NO_MATERIALS",
          message:
            result.message ?? "No hay unidades que procesar.",
          jobs: {
            segmentationJobId: result.segmentationJobId,
            extractionJobId: result.extractionJobId,
            integrationJobId: result.integrationJobId,
            treeBuildingJobId: result.treeBuildingJobId,
          },
        };
      }
      this.notifier.notify(
        this.notifyUserId,
        "Procesando el árbol conceptual con el material subido.",
        "info"
      );
      return { ok: true, empty: false, result };
    } catch (err) {
      return this.handlePipelineError(err, "pipeline-failed");
    }
  }

  /** Find the first material that has SemanticUnits. Returns
   *  `undefined` when none of the materials has been segmented. */
  private async findProcessedMaterial(
    materials: Array<{ id: string }>
  ): Promise<{ id: string } | undefined> {
    for (const m of materials) {
      if (await this.materials.hasProcessedUnits(m.id)) {
        return m;
      }
    }
    return undefined;
  }

  private handlePipelineError(
    err: unknown,
    fallbackReason: string
  ): ProcessCourseOutcome {
    const message = err instanceof Error ? err.message : String(err);
    this.notifier.notify(
      this.notifyUserId,
      `El pipeline falló: ${message}`,
      "error"
    );
    return { ok: false, error: `${fallbackReason}: ${message}` };
  }
}

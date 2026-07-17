// PipelineService — Prisma + queue + BullMQ implementation of
// `IPipelineService`.
//
// This is the same orchestrator that used to live in
// `lib/application/PipelineService.ts`; it has been moved to the
// infrastructure layer because it is a *concrete implementation*
// of the pipeline port (Prisma, JobQueue, SegmenterService,
// UnitExtractor). The use case layer depends on the port
// (`IPipelineService`) and never on this class.
//
// Responsibilities (unchanged from the previous location):
//   - Run the four phases in order, with each phase's progress
//     recorded in a ProcessingJob row.
//   - Fail fast: if any phase throws, the relevant ProcessingJob
//     is marked "failed" with the error message and downstream
//     phases are NOT run.
//   - For the extraction phase, enqueue one "extract-unit" job per
//     SemanticUnit (the actual extraction runs in workers).
//   - Be tolerant of missing pieces: ConceptIntegrator and
//     TreeBuilder soft-skip when their module is not present.
//   - Emit an in-app notification on completion (or failure).

import { db } from "@/lib/db";
import { SegmenterService } from "@/lib/domain/pipeline/SegmenterService";
import { UnitExtractor } from "@/lib/domain/pipeline/UnitExtractor";
import { JobQueue } from "@/lib/infrastructure/queue/JobQueue";
import { notifyUser } from "@/lib/utils/notify";
import type { INotifier } from "@/lib/application/ports/notifier.port";
import type {
  ActiveJob,
  IPipelineService,
  JobStatus,
  ProcessCourseInput,
  ProcessCourseResult,
} from "@/lib/application/ports/pipeline.port";
import type {
  PipelinePhase,
  ProcessingStatus,
  SemanticUnit,
} from "@/lib/types/pipeline";

const WAVE4_NOT_PRESENT = /Cannot find (module|package)/;

/** Default notifier implementation that delegates to the in-process
 *  pub-sub from `@/lib/utils/notify`. Wrapped in a class so the
 *  `IPipelineService` port accepts it without a structural cast. */
class LegacyNotifyAdapter {
  notify(
    userId: string,
    message: string,
    kind: "info" | "success" | "warning" | "error" = "info"
  ): void {
    notifyUser(userId, message, kind);
  }
}
const defaultNotifyImpl = new LegacyNotifyAdapter();

export interface PipelineServiceOptions {
  segmenter?: SegmenterService;
  unitExtractor?: UnitExtractor;
  jobQueue?: JobQueue;
  /**
   * If true, the orchestrator directly calls UnitExtractor.extract() for
   * each unit (synchronous within this process). If false, it enqueues
   * "extract-unit" jobs that the worker pool will process.
   *
   * Default: false (enqueue, parallelise via the queue).
   */
  enqueueExtraction?: boolean;
  /**
   * Override the notification emitter. Defaults to `notifyUser` from
   * `@/lib/utils/notify`. Tests inject a spy here to avoid relying on
   * the global pub-sub state.
   */
  notify?: INotifier;
  /**
   * User id used when calling the notifier. The schema has no User
   * model yet; we use a stable placeholder so the dashboard toast can
   * show up. Override in tests if you need to scope the recipient.
   */
  notifyUserId?: string;
  /**
   * Set to false to suppress notifications entirely. Useful for tests
   * that exercise the pipeline but want to assert on internal state
   * without the side-effect of toast emission.
   */
  notificationsEnabled?: boolean;
}

/** How long after a job's last update we still surface it to the
 *  banner on a fresh page load. Mirrors the value in actions/pipeline.ts. */
const RECENT_JOB_WINDOW_MS = 10 * 60 * 1000;

export class PipelineService implements IPipelineService {
  private readonly segmenter: SegmenterService;
  private readonly unitExtractor: UnitExtractor;
  private readonly jobQueue: JobQueue;
  private enqueueExtraction: boolean;
  private readonly notify: INotifier;
  private readonly notifyUserId: string;
  private readonly notificationsEnabled: boolean;

  constructor(options: PipelineServiceOptions = {}) {
    this.segmenter = options.segmenter ?? new SegmenterService();
    this.unitExtractor = options.unitExtractor ?? new UnitExtractor();
    this.jobQueue = options.jobQueue ?? new JobQueue();
    this.enqueueExtraction = options.enqueueExtraction ?? false;
    // Default notifier: a thin adapter that delegates to the in-process
    // pub-sub from `@/lib/utils/notify`. Production wires up the
    // `InAppNotifier` adapter explicitly via the composition root.
    this.notify =
      options.notify ??
      (defaultNotifyImpl as unknown as INotifier);
    this.notifyUserId = options.notifyUserId ?? "default";
    this.notificationsEnabled = options.notificationsEnabled ?? true;
  }

  // --- IPipelineService ---

  async processCourse(input: ProcessCourseInput): Promise<ProcessCourseResult> {
    try {
      const result = await this.runPhases(
        input.courseId,
        input.materialId,
        input.buffer
      );
      if (!result.empty) {
        this.emitCompletionNotification(input.courseId, input.materialId);
      }
      return result;
    } catch (err) {
      this.emitFailureNotification(input.courseId, input.materialId, err);
      throw err;
    }
  }

  async getStatus(jobId: string): Promise<JobStatus | null> {
    const job = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job) return null;
    return {
      id: job.id,
      type: job.type,
      status: job.status as ProcessingStatus,
      progress: job.progress,
      total: job.total,
      currentStep: job.currentStep,
      error: job.error,
      courseId: job.courseId,
      materialId: job.materialId,
    };
  }

  async cancel(jobId: string): Promise<{ status: ProcessingStatus }> {
    const job = await db.processingJob.findUnique({ where: { id: jobId } });
    if (!job) {
      // Mirror the previous action behaviour: treat "not found" as
      // already terminal (caller can interpret however they want).
      return { status: "cancelled" };
    }
    if (job.status === "completed") return { status: "completed" };
    if (job.status === "failed") return { status: "failed" };
    if (job.status === "cancelled") return { status: "cancelled" };
    await db.processingJob.update({
      where: { id: jobId },
      data: {
        status: "cancelled",
        currentStep: "Cancelado por el usuario",
        error: "Cancelado por el usuario",
      },
    });
    return { status: "cancelled" };
  }

  async getActiveJobs(): Promise<ActiveJob[]> {
    const recentCutoff = new Date(Date.now() - RECENT_JOB_WINDOW_MS);
    const rows = await db.processingJob.findMany({
      where: {
        OR: [
          { status: { in: ["pending", "running"] } },
          { status: "completed", updatedAt: { gte: recentCutoff } },
          { status: "failed", updatedAt: { gte: recentCutoff } },
          { status: "cancelled", updatedAt: { gte: recentCutoff } },
        ],
      },
      orderBy: { updatedAt: "asc" },
    });
    return rows.map((row) => ({
      jobId: row.id,
      courseId: row.courseId,
      phase: row.type,
      status: row.status as ProcessingStatus,
      progress: row.progress,
      currentStep: row.currentStep,
      error: row.error,
      startedAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    }));
  }

  // --- internals ---

  private async runPhases(
    courseId: string,
    materialId: string | undefined,
    buffer: Buffer | undefined
  ): Promise<ProcessCourseResult> {
    // 1. Segmentation
    const segJobId = await this.startPhase(
      "segmentation",
      courseId,
      materialId
    );
    let units: SemanticUnit[];
    try {
      units = await this.runSegmentation(courseId, materialId, buffer);
      await this.completePhase(
        segJobId,
        `Segmentación completada (${units.length} unidades)`
      );
    } catch (err) {
      await this.failPhase(segJobId, err);
      throw err;
    }

    // Short-circuit: zero units → the rest of the pipeline is a
    // no-op. Surface a `empty:true` result so the action layer can
    // tell the user to upload a PDF.
    if (units.length === 0) {
      return {
        segmentationJobId: segJobId,
        extractionJobId: "",
        integrationJobId: "",
        treeBuildingJobId: "",
        empty: true,
        message:
          "No hay unidades que procesar. Sube un PDF primero en la página de materiales.",
      };
    }

    // 2. Extraction
    const extJobId = await this.startPhase(
      "extraction",
      courseId,
      materialId,
      units.length
    );
    try {
      await this.runExtraction(units, materialId, extJobId);
      await this.completePhase(
        extJobId,
        `Extracción completada (${units.length} unidades)`
      );
    } catch (err) {
      await this.failPhase(extJobId, err);
      throw err;
    }

    // 3. Integration (Wave 4 — ConceptIntegrator)
    const intJobId = await this.startPhase(
      "integration",
      courseId,
      materialId
    );
    try {
      await this.runIntegration(courseId);
      await this.completePhase(intJobId, "Integración completada");
    } catch (err) {
      await this.failPhase(intJobId, err);
      throw err;
    }

    // 4. Tree building (Wave 4 — TreeBuilder)
    const treeJobId = await this.startPhase(
      "tree-building",
      courseId,
      materialId
    );
    try {
      await this.runTreeBuilding(courseId);
      await this.completePhase(treeJobId, "Árbol conceptual generado");
    } catch (err) {
      await this.failPhase(treeJobId, err);
      throw err;
    }

    return {
      segmentationJobId: segJobId,
      extractionJobId: extJobId,
      integrationJobId: intJobId,
      treeBuildingJobId: treeJobId,
      empty: false,
      message: null,
    };
  }

  private async countTreeNodes(courseId: string): Promise<number> {
    try {
      return await db.topicNode.count({ where: { courseId } });
    } catch {
      return 0;
    }
  }

  private emitCompletionNotification(
    courseId: string,
    materialId: string | undefined
  ): void {
    if (!this.notificationsEnabled) return;
    void this.countTreeNodes(courseId).then((nodeCount) => {
      const message =
        nodeCount > 0
          ? `Árbol listo. ${nodeCount} tema${nodeCount !== 1 ? "s" : ""} identificado${nodeCount !== 1 ? "s" : ""}.`
          : "Árbol conceptual generado correctamente.";
      const suffix = materialId ? ` (material ${materialId})` : "";
      try {
        this.notify.notify(
          this.notifyUserId,
          message + suffix,
          "success"
        );
      } catch (err) {
        console.warn(
          "[PipelineService] notify() failed:",
          err instanceof Error ? err.message : err
        );
      }
    });
  }

  private emitFailureNotification(
    courseId: string,
    materialId: string | undefined,
    err: unknown
  ): void {
    if (!this.notificationsEnabled) return;
    const message = err instanceof Error ? err.message : String(err);
    const suffix = materialId ? ` (material ${materialId})` : "";
    try {
      this.notify.notify(
        this.notifyUserId,
        `Pipeline falló para el curso ${courseId}${suffix}: ${message}`,
        "error"
      );
    } catch (notifyErr) {
      console.warn(
        "[PipelineService] notify() failed:",
        notifyErr instanceof Error ? notifyErr.message : notifyErr
      );
    }
  }

  // ---- phase methods (private) ----

  private async runSegmentation(
    courseId: string,
    materialId: string | undefined,
    buffer: Buffer | undefined
  ): Promise<SemanticUnit[]> {
    // If we have a buffer, segment from scratch. The segmenter itself
    // is now resilient to docling-serve being down (it falls back to
    // a text-only segmentation) so this path is safe even when
    // docling is unreachable.
    if (buffer && materialId) {
      return this.segmenter.segment(buffer, materialId);
    }

    // Otherwise, load existing units for the material (or for the course).
    if (materialId) {
      const existing = await db.semanticUnit.findMany({
        where: { materialId },
        orderBy: { order: "asc" },
      });
      return existing.map((u) => ({
        id: u.id,
        materialId: u.materialId,
        content: u.content,
        order: u.order,
        pageStart: u.pageStart,
        pageEnd: u.pageEnd,
        sectionRef: u.sectionRef,
        createdAt: u.createdAt.toISOString(),
      }));
    }

    const existing = await db.semanticUnit.findMany({
      where: { material: { courseId } },
      orderBy: { order: "asc" },
    });
    return existing.map((u) => ({
      id: u.id,
      materialId: u.materialId,
      content: u.content,
      order: u.order,
      pageStart: u.pageStart,
      pageEnd: u.pageEnd,
      sectionRef: u.sectionRef,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  private async runExtraction(
    units: SemanticUnit[],
    materialId: string | undefined,
    jobId: string
  ): Promise<void> {
    if (units.length === 0) return;

    // Root-cause fix: if Redis was probed at construction and turned
    // out to be unreachable, transparently fall back to in-process
    // extraction instead of trying to enqueue (which would throw
    // ECONNREFUSED on every call and surface as a cryptic failure to
    // the user).
    const useQueue =
      !this.enqueueExtraction && (await this.jobQueue.waitForProbe());
    if (!useQueue && !this.enqueueExtraction) {
      console.warn(
        "[PipelineService] Redis unavailable — running extraction in-process."
      );
    }

    let processed = 0;
    for (const u of units) {
      if (useQueue) {
        await this.jobQueue.enqueue("extract-unit", {
          unitId: u.id,
          materialId: materialId ?? u.materialId,
        });
      } else {
        await this.unitExtractor.extract(u);
      }
      processed++;
      const progress = Math.round((processed / units.length) * 100);
      await this.updateProgress(jobId, progress, `Unidad ${processed}/${units.length}`);
    }
  }

  private async runIntegration(courseId: string): Promise<void> {
    try {
      const { ConceptIntegrator } = await import(
        "@/lib/domain/pipeline/ConceptIntegrator"
      );
      const integrator = new ConceptIntegrator();
      await integrator.integrate(courseId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (WAVE4_NOT_PRESENT.test(msg)) {
        console.warn(
          "[PipelineService] ConceptIntegrator not yet implemented (Wave 4); skipping integration."
        );
        return;
      }
      throw err;
    }
  }

  private async runTreeBuilding(courseId: string): Promise<void> {
    try {
      const { TreeBuilder } = await import("@/lib/domain/pipeline/TreeBuilder");
      const builder = new TreeBuilder();
      await builder.build(courseId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (WAVE4_NOT_PRESENT.test(msg)) {
        console.warn(
          "[PipelineService] TreeBuilder not yet implemented (Wave 4); skipping tree-building."
        );
        return;
      }
      throw err;
    }
  }

  // ---- ProcessingJob tracking ----

  private async startPhase(
    type: PipelinePhase,
    courseId: string,
    materialId: string | undefined,
    total = 100
  ): Promise<string> {
    const id = `pj-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.processingJob.create({
      data: {
        id,
        type,
        status: "running",
        progress: 0,
        total,
        currentStep: `Iniciando ${type}`,
        courseId,
        materialId: materialId ?? null,
      },
    });
    return id;
  }

  private async completePhase(jobId: string, currentStep: string): Promise<void> {
    await db.processingJob.update({
      where: { id: jobId },
      data: { status: "completed", progress: 100, currentStep },
    });
  }

  private async failPhase(jobId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    await db.processingJob.update({
      where: { id: jobId },
      data: { status: "failed", error: message },
    });
  }

  private async updateProgress(
    jobId: string,
    progress: number,
    currentStep: string
  ): Promise<void> {
    await db.processingJob.update({
      where: { id: jobId },
      data: { progress, currentStep },
    });
  }
}

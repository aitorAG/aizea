// Tests for the ProcessCourseUseCase — the "Generar árbol" use case.
//
// These are the regression tests for the bug "Generar árbol dice
// Sin contenido que procesar". The use case is exercised through
// its three ports (pipeline, materials, notifier) so the test is
// independent of the DB, the filesystem, the network, and Next.js.
//
// v1.5 finding 2.5 — the previous implementation only processed
// ONE material per click, silently dropping every other PDF in
// the course. These tests now cover the multi-material behaviour:
//   * iterate over every material
//   * keep going when one material fails
//   * surface per-material errors without aborting
//   * the resulting tree contains concepts from every material
//     that succeeded.

import { describe, it, expect, vi } from "vitest";
import { ProcessCourseUseCase } from "@/lib/application/use-cases/process-course.use-case";
import type { IMaterialRepository } from "@/lib/application/ports/material-repository.port";
import type {
  IPipelineService,
  ProcessCourseResult,
} from "@/lib/application/ports/pipeline.port";
import type { INotifier } from "@/lib/application/ports/notifier.port";

// ---------- fakes ----------

function makePipeline(
  impl?: (input: Parameters<IPipelineService["processCourse"]>[0]) => Promise<ProcessCourseResult>
): { pipeline: IPipelineService; processCourse: ReturnType<typeof vi.fn> } {
  const processCourse = vi.fn(
    impl ??
      (async () => ({
        segmentationJobId: "seg-1",
        extractionJobId: "ext-1",
        integrationJobId: "int-1",
        treeBuildingJobId: "tree-1",
        empty: false,
        message: null,
      }))
  );
  return {
    pipeline: { processCourse } as unknown as IPipelineService,
    processCourse,
  };
}

function makeMaterials(overrides: Partial<{
  materials: Array<{ id: string; filename: string; courseId: string }>;
  hasProcessedFor: (id: string) => boolean;
  bufferFor: (id: string) => Buffer | null;
}>): {
  materials: IMaterialRepository;
  findByCourseId: ReturnType<typeof vi.fn>;
  hasProcessedUnits: ReturnType<typeof vi.fn>;
  readBuffer: ReturnType<typeof vi.fn>;
} {
  const findByCourseId = vi.fn(async () => overrides.materials ?? []);
  const hasProcessedUnits = vi.fn(
    async (id: string) => overrides.hasProcessedFor?.(id) ?? false
  );
  const readBuffer = vi.fn(
    async (id: string) => overrides.bufferFor?.(id) ?? null
  );
  return {
    materials: {
      findById: vi.fn(),
      findByCourseId,
      hasProcessedUnits,
      readBuffer,
      create: vi.fn(),
    } as unknown as IMaterialRepository,
    findByCourseId,
    hasProcessedUnits,
    readBuffer,
  };
}

function makeNotifier(): { notifier: INotifier; notify: ReturnType<typeof vi.fn> } {
  const notify = vi.fn();
  return { notifier: { notify } as unknown as INotifier, notify };
}

// ---------- the tests ----------

describe("ProcessCourseUseCase — the 'Generar árbol' fix", () => {
  describe("NO_MATERIALS branch", () => {
    it("returns NO_MATERIALS when the course has no materials at all", async () => {
      const { materials, findByCourseId } = makeMaterials({ materials: [] });
      const { pipeline, processCourse } = makePipeline();
      const { notifier, notify } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && outcome.empty) {
        expect(outcome.reason).toBe("NO_MATERIALS");
        expect(outcome.message).toMatch(/sube un pdf/i);
        expect(outcome.materialErrors).toEqual([]);
        expect(outcome.jobs.segmentationJobId).toBe("");
      }
      expect(findByCourseId).toHaveBeenCalledWith("course-1");
      // The pipeline MUST NOT be called when there are no materials.
      expect(processCourse).not.toHaveBeenCalled();
      // The user is told what to do.
      expect(notify).toHaveBeenCalledWith(
        "default",
        expect.stringMatching(/sube un pdf/i),
        "info"
      );
    });
  });

  describe("happy path — re-run on existing units", () => {
    it("delegates to the pipeline WITHOUT a buffer when a material has SemanticUnits", async () => {
      const materials = [
        { id: "mat-1", filename: "doc.pdf", courseId: "course-1" },
      ];
      const { materials: repo } = makeMaterials({
        materials,
        hasProcessedFor: () => true,
      });
      const { pipeline, processCourse } = makePipeline();
      const { notifier } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && !outcome.empty) {
        expect(outcome.result.segmentationJobId).toBe("seg-1");
        expect(outcome.processedMaterials).toBe(1);
        expect(outcome.totalMaterials).toBe(1);
        expect(outcome.materialErrors).toEqual([]);
      }
      // The use case passes the material id (so the orchestrator
      // re-uses the existing units) and explicitly NOT a buffer.
      expect(processCourse).toHaveBeenCalledTimes(1);
      const input = processCourse.mock.calls[0][0];
      expect(input.courseId).toBe("course-1");
      expect(input.materialId).toBe("mat-1");
      expect(input.buffer).toBeUndefined();
    });
  });

  describe("recovery path — read buffer from disk", () => {
    it("reads the file from disk and re-runs with the buffer when no material has SemanticUnits (the docling-down case)", async () => {
      const materials = [
        { id: "mat-1", filename: "doc.pdf", courseId: "course-1" },
      ];
      const { materials: repo, readBuffer } = makeMaterials({
        materials,
        hasProcessedFor: () => false,
        bufferFor: () => Buffer.from("pdf bytes from disk"),
      });
      const { pipeline, processCourse } = makePipeline();
      const { notifier } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && !outcome.empty) {
        expect(outcome.empty).toBe(false);
        expect(outcome.processedMaterials).toBe(1);
      }
      // CRITICAL: the buffer must be passed so the segmenter has
      // bytes to work on. This is the bug the use case fixes.
      const input = processCourse.mock.calls[0][0];
      expect(Buffer.isBuffer(input.buffer)).toBe(true);
      expect(input.buffer.toString()).toBe("pdf bytes from disk");
      expect(input.materialId).toBe("mat-1");
      expect(input.force).toBe(true);
      // readBuffer was called on the repository.
      expect(readBuffer).toHaveBeenCalledWith("mat-1");
    });

    it("returns ALL_FAILED with FILE_MISSING messages when the file is not on disk for the only material", async () => {
      const materials = [
        { id: "mat-1", filename: "doc.pdf", courseId: "course-1" },
      ];
      const { materials: repo } = makeMaterials({
        materials,
        hasProcessedFor: () => false,
        bufferFor: () => null,
      });
      const { pipeline, processCourse } = makePipeline();
      const { notifier, notify } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && outcome.empty) {
        // When every material in the course is FILE_MISSING, we
        // surface FILE_MISSING (singular reason) so the UI can
        // show "Sube el PDF de nuevo" copy.
        expect(outcome.reason).toBe("FILE_MISSING");
        expect(outcome.message).toMatch(/no está disponible|sube el pdf de nuevo/i);
        expect(outcome.materialErrors[0].filename).toBe("doc.pdf");
        expect(outcome.materialErrors[0].error).toMatch(/no está disponible/i);
      }
      // Pipeline MUST NOT be called when the file is missing.
      expect(processCourse).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(
        "default",
        expect.stringMatching(/no está disponible/i),
        "error"
      );
    });

    it("processes EVERY material — not just the latest (v1.5 #2.5)", async () => {
      const materials = [
        { id: "old-mat", filename: "old.pdf", courseId: "course-1" },
        { id: "latest-mat", filename: "latest.pdf", courseId: "course-1" },
      ];
      const { materials: repo, readBuffer } = makeMaterials({
        materials,
        hasProcessedFor: () => false,
        bufferFor: (id) => Buffer.from(`bytes for ${id}`),
      });
      const { pipeline, processCourse } = makePipeline();
      const { notifier } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && !outcome.empty) {
        // The previous bug: only the latest material was processed.
        // The fix: every material in the course is processed.
        expect(outcome.processedMaterials).toBe(2);
        expect(outcome.totalMaterials).toBe(2);
        expect(outcome.materialErrors).toEqual([]);
      }
      // The pipeline was called for BOTH materials.
      expect(processCourse).toHaveBeenCalledTimes(2);
      const calledIds = processCourse.mock.calls.map((c) => c[0].materialId);
      expect(calledIds).toEqual(["old-mat", "latest-mat"]);
      // Both materials' buffers were read.
      expect(readBuffer).toHaveBeenCalledWith("old-mat");
      expect(readBuffer).toHaveBeenCalledWith("latest-mat");
    });
  });

  describe("mixed materials", () => {
    it("processes EVERY material — picks the first with units, then continues with the rest (v1.5 #2.5)", async () => {
      const materials = [
        { id: "old-mat", filename: "old.pdf", courseId: "course-1" },
        { id: "newer-mat", filename: "newer.pdf", courseId: "course-1" },
      ];
      const { materials: repo, hasProcessedUnits } = makeMaterials({
        materials,
        hasProcessedFor: (id) => id === "old-mat",
        // newer-mat has no units, so it must fall through to the
        // buffer-read path. Provide a buffer so it can be
        // processed.
        bufferFor: (id) => Buffer.from(`bytes for ${id}`),
      });
      const { pipeline, processCourse } = makePipeline();
      const { notifier } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && !outcome.empty) {
        expect(outcome.processedMaterials).toBe(2);
      }
      // The pipeline ran for BOTH materials. The first used the
      // existing units (no buffer); the second read its buffer
      // from disk because it had no SemanticUnits yet.
      expect(processCourse).toHaveBeenCalledTimes(2);
      const firstInput = processCourse.mock.calls[0][0];
      expect(firstInput.materialId).toBe("old-mat");
      expect(firstInput.buffer).toBeUndefined();
      const secondInput = processCourse.mock.calls[1][0];
      expect(secondInput.materialId).toBe("newer-mat");
      expect(Buffer.isBuffer(secondInput.buffer)).toBe(true);
      // hasProcessedUnits was probed for both materials.
      expect(hasProcessedUnits.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("error handling — one failing material does not abort the rest", () => {
    it("continues with the remaining materials when one throws on a fresh run (v1.5 #2.5)", async () => {
      const materials = [
        { id: "good-1", filename: "good-1.pdf", courseId: "course-1" },
        { id: "bad", filename: "bad.pdf", courseId: "course-1" },
        { id: "good-2", filename: "good-2.pdf", courseId: "course-1" },
      ];
      const { materials: repo } = makeMaterials({
        materials,
        hasProcessedFor: () => false,
        bufferFor: (id) => Buffer.from(`bytes for ${id}`),
      });
      // Pipeline throws only when the bad material is processed.
      const { pipeline, processCourse } = makePipeline(async (input) => {
        if (input.materialId === "bad") {
          throw new Error("segmenter blew up");
        }
        return {
          segmentationJobId: `seg-${input.materialId}`,
          extractionJobId: `ext-${input.materialId}`,
          integrationJobId: `int-${input.materialId}`,
          treeBuildingJobId: `tree-${input.materialId}`,
          empty: false,
          message: null,
        };
      });
      const { notifier, notify } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      // Outcome is OK because at least one material succeeded.
      expect(outcome.ok).toBe(true);
      if (outcome.ok && !outcome.empty) {
        expect(outcome.processedMaterials).toBe(2);
        expect(outcome.totalMaterials).toBe(3);
        // The bad material is reported in materialErrors with
        // a clear per-file error message.
        expect(outcome.materialErrors).toHaveLength(1);
        expect(outcome.materialErrors[0]).toEqual({
          materialId: "bad",
          filename: "bad.pdf",
          error: "segmenter blew up",
        });
      }
      // The pipeline ran for all three materials.
      expect(processCourse).toHaveBeenCalledTimes(3);
      // The user got a per-material error notification.
      expect(notify).toHaveBeenCalledWith(
        "default",
        expect.stringMatching(/no se pudo procesar.*bad\.pdf.*segmenter blew up/i),
        "error"
      );
    });

    it("continues with the remaining materials when one throws on the re-run path (v1.5 #2.5)", async () => {
      const materials = [
        { id: "ok-mat", filename: "ok.pdf", courseId: "course-1" },
        { id: "broken-mat", filename: "broken.pdf", courseId: "course-1" },
      ];
      // ok-mat already has units (fast path), broken-mat does not
      // (so it falls through to the buffer read, but we'll mock
      // the pipeline to throw for it anyway via the no-units path).
      const { materials: repo } = makeMaterials({
        materials,
        hasProcessedFor: (id) => id === "ok-mat",
        bufferFor: (id) =>
          id === "broken-mat" ? Buffer.from("bytes for broken-mat") : null,
      });
      const { pipeline, processCourse } = makePipeline(async (input) => {
        if (input.materialId === "broken-mat") {
          throw new Error("integration failed");
        }
        return {
          segmentationJobId: `seg-${input.materialId}`,
          extractionJobId: `ext-${input.materialId}`,
          integrationJobId: `int-${input.materialId}`,
          treeBuildingJobId: `tree-${input.materialId}`,
          empty: false,
          message: null,
        };
      });
      const { notifier } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && !outcome.empty) {
        expect(outcome.processedMaterials).toBe(1);
        expect(outcome.materialErrors).toHaveLength(1);
        expect(outcome.materialErrors[0].error).toBe("integration failed");
      }
      expect(processCourse).toHaveBeenCalledTimes(2);
    });

    it("returns ALL_FAILED when every material in the course throws", async () => {
      const materials = [
        { id: "mat-1", filename: "doc.pdf", courseId: "course-1" },
      ];
      const { materials: repo } = makeMaterials({
        materials,
        hasProcessedFor: () => false,
        bufferFor: () => Buffer.from("bytes"),
      });
      const { pipeline } = makePipeline(async () => {
        throw new Error("segmenter blew up");
      });
      const { notifier, notify } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && outcome.empty) {
        expect(outcome.reason).toBe("ALL_FAILED");
        expect(outcome.message).toMatch(/segmenter blew up/);
        expect(outcome.materialErrors[0].filename).toBe("doc.pdf");
      }
      expect(notify).toHaveBeenCalledWith(
        "default",
        expect.stringMatching(/segmenter blew up/i),
        "error"
      );
    });
  });

  describe("propagates an empty result from the pipeline", () => {
    it("returns ALL_EMPTY when the pipeline still finds zero units for every material (e.g. genuinely empty PDFs)", async () => {
      const { materials: repo } = makeMaterials({
        materials: [{ id: "mat-1", filename: "empty.pdf", courseId: "course-1" }],
        hasProcessedFor: () => false,
        bufferFor: () => Buffer.from(""),
      });
      const { pipeline } = makePipeline(async () => ({
        segmentationJobId: "seg-x",
        extractionJobId: "",
        integrationJobId: "",
        treeBuildingJobId: "",
        empty: true,
        message: "No hay unidades que procesar.",
      }));
      const { notifier } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.empty).toBe(true);
        if (outcome.empty) {
          expect(outcome.reason).toBe("ALL_EMPTY");
        }
      }
    });
  });

  describe("partial FILE_MISSING", () => {
    it("returns success when at least one material is processable even if others are missing on disk", async () => {
      const materials = [
        { id: "ok-mat", filename: "ok.pdf", courseId: "course-1" },
        { id: "missing-mat", filename: "missing.pdf", courseId: "course-1" },
      ];
      const { materials: repo } = makeMaterials({
        materials,
        hasProcessedFor: () => false,
        bufferFor: (id) =>
          id === "missing-mat" ? null : Buffer.from(`bytes for ${id}`),
      });
      const { pipeline, processCourse } = makePipeline(async (input) => ({
        segmentationJobId: `seg-${input.materialId}`,
        extractionJobId: `ext-${input.materialId}`,
        integrationJobId: `int-${input.materialId}`,
        treeBuildingJobId: `tree-${input.materialId}`,
        empty: false,
        message: null,
      }));
      const { notifier } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(true);
      if (outcome.ok && !outcome.empty) {
        expect(outcome.processedMaterials).toBe(1);
        expect(outcome.totalMaterials).toBe(2);
        expect(outcome.materialErrors).toHaveLength(1);
        expect(outcome.materialErrors[0].filename).toBe("missing.pdf");
      }
      // Only the OK material reached the pipeline.
      expect(processCourse).toHaveBeenCalledTimes(1);
    });
  });
});

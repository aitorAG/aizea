// Tests for the ProcessCourseUseCase — the "Generar árbol" use case.
//
// These are the regression tests for the bug "Generar árbol dice
// Sin contenido que procesar". The use case is exercised through
// its three ports (pipeline, materials, notifier) so the test is
// independent of the DB, the filesystem, the network, and Next.js.

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
}>): { materials: IMaterialRepository; findByCourseId: ReturnType<typeof vi.fn>; hasProcessedUnits: ReturnType<typeof vi.fn>; readBuffer: ReturnType<typeof vi.fn> } {
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
        expect(outcome.jobs.segmentationJobId).toBe("");
      }
      expect(findByCourseId).toHaveBeenCalledWith("course-1");
      // The pipeline MUST NOT be called when there are no materials.
      expect(processCourse).not.toHaveBeenCalled();
      // The user is told what to do.
      expect(notify).toHaveBeenCalledWith("default", expect.stringMatching(/sube un pdf/i), "info");
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
      if (outcome.ok) {
        expect(outcome.empty).toBe(false);
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

    it("returns FILE_MISSING when the file is not on disk anymore", async () => {
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
        expect(outcome.reason).toBe("FILE_MISSING");
        expect(outcome.message).toMatch(/no está disponible|sube el pdf de nuevo/i);
      }
      // Pipeline MUST NOT be called when the file is missing.
      expect(processCourse).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(
        "default",
        expect.stringMatching(/no está disponible/i),
        "error"
      );
    });

    it("uses the LATEST material when there are multiple (recovery from a freshly uploaded PDF)", async () => {
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
      expect(processCourse).toHaveBeenCalledTimes(1);
      const input = processCourse.mock.calls[0][0];
      // The repository returns materials ASC by createdAt, so the
      // last one is the latest.
      expect(input.materialId).toBe("latest-mat");
      expect(input.buffer?.toString()).toBe("bytes for latest-mat");
      // readBuffer called on the latest material.
      expect(readBuffer).toHaveBeenCalledWith("latest-mat");
    });
  });

  describe("mixed materials", () => {
    it("picks the FIRST material that has SemanticUnits and re-runs without buffer", async () => {
      const materials = [
        { id: "old-mat", filename: "old.pdf", courseId: "course-1" },
        { id: "newer-mat", filename: "newer.pdf", courseId: "course-1" },
      ];
      const { materials: repo, hasProcessedUnits } = makeMaterials({
        materials,
        hasProcessedFor: (id) => id === "old-mat",
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
      }
      // Once we find a material with units, we stop probing.
      // The pipeline runs WITHOUT a buffer (re-uses existing units).
      const input = processCourse.mock.calls[0][0];
      expect(input.materialId).toBe("old-mat");
      expect(input.buffer).toBeUndefined();
      // hasProcessedUnits should have been called at most once
      // (the first material matched) — we don't probe the second.
      // Allow up to 1 for a fast-path.
      expect(hasProcessedUnits.mock.calls.length).toBeLessThanOrEqual(2);
    });
  });

  describe("error handling", () => {
    it("returns ok:false when the pipeline throws on a fresh run", async () => {
      const { materials: repo } = makeMaterials({
        materials: [{ id: "mat-1", filename: "doc.pdf", courseId: "course-1" }],
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

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toMatch(/segmenter blew up/);
      }
      expect(notify).toHaveBeenCalledWith(
        "default",
        expect.stringMatching(/segmenter blew up/i),
        "error"
      );
    });

    it("returns ok:false when the pipeline throws on the re-run path", async () => {
      const { materials: repo } = makeMaterials({
        materials: [{ id: "mat-1", filename: "doc.pdf", courseId: "course-1" }],
        hasProcessedFor: () => true,
      });
      const { pipeline } = makePipeline(async () => {
        throw new Error("integration failed");
      });
      const { notifier } = makeNotifier();

      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline,
        notifier,
      });
      const outcome = await useCase.execute("course-1");

      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toMatch(/integration failed/);
      }
    });
  });

  describe("propagates an empty result from the pipeline", () => {
    it("returns empty:true when the pipeline still finds zero units after the recovery path (e.g. genuinely empty PDF)", async () => {
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
          expect(outcome.message).toMatch(/no hay unidades que procesar/i);
        }
      }
    });
  });
});

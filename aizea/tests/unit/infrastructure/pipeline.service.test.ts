// Tests for the infrastructure-level PipelineService.
//
// This is a unit test (uses a temp DB). The orchestration logic
// hasn't changed from the previous test; the goal of this file is
// to:
//   1. Cover the new `processCourse(input)` port-method signature
//      (instead of the old positional `run(courseId, materialId, buffer)`).
//   2. Cover the new `getStatus`, `cancel`, `getActiveJobs` port
//      methods that previously lived in the action layer.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockSegmenterSegment,
  mockUnitExtractorExtract,
  mockJobEnqueue,
  mockProcessingJobCreate,
  mockProcessingJobUpdate,
  mockProcessingJobFindUnique,
  mockProcessingJobFindMany,
  mockSemanticUnitFindMany,
  mockConceptIntegratorIntegrate,
  mockTreeBuilderBuild,
  mockTopicNodeCount,
} = vi.hoisted(() => ({
  mockSegmenterSegment: vi.fn(),
  mockUnitExtractorExtract: vi.fn(),
  mockJobEnqueue: vi.fn(),
  mockProcessingJobCreate: vi.fn(),
  mockProcessingJobUpdate: vi.fn(),
  mockProcessingJobFindUnique: vi.fn(),
  mockProcessingJobFindMany: vi.fn(),
  mockSemanticUnitFindMany: vi.fn(),
  mockConceptIntegratorIntegrate: vi.fn(),
  mockTreeBuilderBuild: vi.fn(),
  mockTopicNodeCount: vi.fn(),
}));

vi.mock("@/lib/domain/pipeline/SegmenterService", () => ({
  SegmenterService: class MockSegmenterService {
    segment = mockSegmenterSegment;
  },
}));

vi.mock("@/lib/domain/pipeline/UnitExtractor", () => ({
  UnitExtractor: class MockUnitExtractor {
    extract = mockUnitExtractorExtract;
  },
}));

vi.mock("@/lib/domain/pipeline/ConceptIntegrator", () => ({
  ConceptIntegrator: class MockConceptIntegrator {
    integrate = mockConceptIntegratorIntegrate;
  },
}));

vi.mock("@/lib/domain/pipeline/TreeBuilder", () => ({
  TreeBuilder: class MockTreeBuilder {
    build = mockTreeBuilderBuild;
  },
}));

vi.mock("@/lib/infrastructure/queue/JobQueue", () => ({
  JobQueue: class MockJobQueue {
    enqueue = mockJobEnqueue;
    close = vi.fn();
    waitForProbe = vi.fn().mockResolvedValue(true);
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    processingJob: {
      create: mockProcessingJobCreate,
      update: mockProcessingJobUpdate,
      findUnique: mockProcessingJobFindUnique,
      findMany: mockProcessingJobFindMany,
    },
    semanticUnit: {
      findMany: mockSemanticUnitFindMany,
    },
    topicNode: {
      count: mockTopicNodeCount,
    },
  },
}));

import { PipelineService } from "@/lib/infrastructure/pipeline/pipeline.service";

describe("PipelineService (infrastructure layer)", () => {
  let service: PipelineService;
  let createdJobs: Array<{ id: string; type: string; status: string; progress: number; total: number; currentStep: string | null; error: string | null; courseId: string | null; materialId: string | null }>;
  let jobCounter: number;

  beforeEach(() => {
    vi.clearAllMocks();
    createdJobs = [];
    jobCounter = 0;

    mockProcessingJobCreate.mockImplementation(
      async ({ data }: { data: { id?: string; type: string; courseId: string; materialId?: string; status?: string; progress?: number; total?: number; currentStep?: string | null } }) => {
        const id = data.id ?? `job-${++jobCounter}`;
        const job = {
          id,
          type: data.type,
          status: data.status ?? "running",
          progress: data.progress ?? 0,
          total: data.total ?? 100,
          currentStep: data.currentStep ?? null,
          error: null,
          courseId: data.courseId,
          materialId: data.materialId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        createdJobs.push(job);
        return job;
      }
    );
    mockProcessingJobUpdate.mockImplementation(
      async ({ where, data }: { where: { id: string }; data: { status?: string; progress?: number; currentStep?: string | null; error?: string | null } }) => {
        const job = createdJobs.find((j) => j.id === where.id);
        if (!job) throw new Error("job not found");
        if (data.status !== undefined) job.status = data.status;
        if (data.progress !== undefined) job.progress = data.progress;
        if (data.currentStep !== undefined) job.currentStep = data.currentStep;
        if (data.error !== undefined) job.error = data.error;
        return job;
      }
    );
    mockProcessingJobFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      return createdJobs.find((j) => j.id === where.id) ?? null;
    });
    mockProcessingJobFindMany.mockImplementation(async () => createdJobs);

    mockSegmenterSegment.mockResolvedValue([
      {
        id: "u-1",
        materialId: "m-1",
        content: "x",
        order: 0,
        pageStart: 1,
        pageEnd: 1,
        sectionRef: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    mockUnitExtractorExtract.mockResolvedValue({
      id: "rep-1",
      unitId: "u-1",
      concepts: [],
      mainIdeas: [],
      formulas: [],
      figures: [],
      prerequisites: [],
      introduces: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockJobEnqueue.mockResolvedValue({ jobId: "queue-job-1" });
    mockSemanticUnitFindMany.mockResolvedValue([
      {
        id: "u-1",
        materialId: "m-1",
        content: "x",
        order: 0,
        pageStart: 1,
        pageEnd: 1,
        sectionRef: null,
        createdAt: new Date(),
      },
    ]);
    mockConceptIntegratorIntegrate.mockResolvedValue([]);
    mockTreeBuilderBuild.mockResolvedValue([]);
    mockTopicNodeCount.mockResolvedValue(0);

    service = new PipelineService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("processCourse", () => {
    it("creates a ProcessingJob for each phase", async () => {
      await service.processCourse({
        courseId: "c-1",
        materialId: "m-1",
        buffer: Buffer.from("pdf"),
      });
      const types = createdJobs.map((j) => j.type);
      expect(types).toContain("segmentation");
      expect(types).toContain("extraction");
      expect(types).toContain("integration");
      expect(types).toContain("tree-building");
    });

    it("passes the buffer to the segmenter when buffer + materialId are present", async () => {
      await service.processCourse({
        courseId: "c-1",
        materialId: "m-1",
        buffer: Buffer.from("real-pdf-bytes"),
      });
      expect(mockSegmenterSegment).toHaveBeenCalledWith(
        Buffer.from("real-pdf-bytes"),
        "m-1"
      );
    });

    it("returns empty:true when the segmenter yields zero units", async () => {
      mockSegmenterSegment.mockResolvedValue([]);
      const result = await service.processCourse({
        courseId: "c-empty",
        materialId: "m-1",
        buffer: Buffer.from("pdf"),
      });
      expect(result.empty).toBe(true);
      expect(result.message).toMatch(/no hay unidades|sube un pdf/i);
      // Extraction / integration / tree-building were skipped.
      const types = createdJobs.map((j) => j.type);
      expect(types).toContain("segmentation");
      expect(types).not.toContain("extraction");
    });

    it("marks the segmentation job as failed when SegmenterService throws", async () => {
      mockSegmenterSegment.mockRejectedValue(new Error("seg failed"));
      await expect(
        service.processCourse({ courseId: "c-1", materialId: "m-1", buffer: Buffer.from("pdf") })
      ).rejects.toThrow();
      const seg = createdJobs.find((j) => j.type === "segmentation");
      expect(seg?.status).toBe("failed");
      expect(seg?.error).toContain("seg failed");
    });
  });

  describe("cooperative cancellation (Fase 2.4)", () => {
    it("stops the extraction loop early and does NOT process remaining units", async () => {
      // Three units; cancel fires before the 2nd. Only the 1st is extracted.
      const units = [1, 2, 3].map((n) => ({
        id: `u-${n}`,
        materialId: "m-1",
        content: "x",
        order: n - 1,
        pageStart: 1,
        pageEnd: 1,
        sectionRef: null,
        createdAt: new Date().toISOString(),
      }));
      mockSegmenterSegment.mockResolvedValue(units);

      // isJobCancelled: false for unit 1, true from unit 2 onward (only for
      // the extraction job — segmentation already completed).
      let extractionChecks = 0;
      const cancellingService = new PipelineService({
        isJobCancelled: async () => {
          extractionChecks++;
          return extractionChecks >= 2; // cancel arrives before the 2nd unit
        },
      });

      await expect(
        cancellingService.processCourse({
          courseId: "c-cancel",
          materialId: "m-1",
          buffer: Buffer.from("pdf"),
        })
      ).rejects.toThrow(/cancel/i);

      // Only the first unit was extracted (loop bailed before unit 2).
      expect(mockUnitExtractorExtract).toHaveBeenCalledTimes(1);
      // Integration / tree-building never ran.
      const types = createdJobs.map((j) => j.type);
      expect(types).not.toContain("integration");
      expect(types).not.toContain("tree-building");
    });

    it("does NOT overwrite a cancelled job's status with 'failed'", async () => {
      const units = [1, 2].map((n) => ({
        id: `u-${n}`,
        materialId: "m-1",
        content: "x",
        order: n - 1,
        pageStart: 1,
        pageEnd: 1,
        sectionRef: null,
        createdAt: new Date().toISOString(),
      }));
      mockSegmenterSegment.mockResolvedValue(units);

      const cancellingService = new PipelineService({
        // Cancel immediately (before the 1st unit). The extraction job row
        // is marked "cancelled" out-of-band to mirror the real cancel path.
        isJobCancelled: async (jobId: string) => {
          const job = createdJobs.find((j) => j.id === jobId);
          if (job && job.type === "extraction") {
            job.status = "cancelled";
            return true;
          }
          return false;
        },
      });

      await expect(
        cancellingService.processCourse({
          courseId: "c-cancel-2",
          materialId: "m-1",
          buffer: Buffer.from("pdf"),
        })
      ).rejects.toThrow(/cancel/i);

      // failPhase must NOT flip the cancelled extraction job to "failed",
      // nor write a failure error message (it stays as the cancel left it).
      const ext = createdJobs.find((j) => j.type === "extraction");
      expect(ext?.status).toBe("cancelled");
      expect(ext?.error).toBeFalsy();
    });
  });

  describe("getStatus", () => {
    it("returns the job when it exists", async () => {
      await service.processCourse({
        courseId: "c-1",
        materialId: "m-1",
        buffer: Buffer.from("pdf"),
      });
      const seg = createdJobs.find((j) => j.type === "segmentation")!;
      const status = await service.getStatus(seg.id);
      expect(status?.id).toBe(seg.id);
      expect(status?.type).toBe("segmentation");
    });

    it("returns null when the job does not exist", async () => {
      const status = await service.getStatus("non-existent");
      expect(status).toBeNull();
    });
  });

  describe("cancel", () => {
    it("flips a running job to cancelled", async () => {
      // Pre-seed a "running" row in the local tracking array so
      // the update mock (which only mutates rows in createdJobs)
      // can find it.
      const runningRow = {
        id: "running-job",
        type: "extraction",
        status: "running",
        progress: 42,
        currentStep: "Unit 5/10",
        error: null,
        courseId: "c-1",
        materialId: "m-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        total: 100,
      };
      createdJobs.push(runningRow);
      // findUnique returns the row.
      mockProcessingJobFindUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          createdJobs.find((j) => j.id === where.id) ?? null
      );
      const result = await service.cancel("running-job");
      expect(result.status).toBe("cancelled");
      expect(runningRow.status).toBe("cancelled");
    });

    it("is idempotent on a completed job", async () => {
      const doneRow = {
        id: "done-job",
        type: "extraction",
        status: "completed",
        progress: 100,
        currentStep: "done",
        error: null,
        courseId: "c-1",
        materialId: "m-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        total: 100,
      };
      createdJobs.push(doneRow);
      mockProcessingJobFindUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          createdJobs.find((j) => j.id === where.id) ?? null
      );
      const result = await service.cancel("done-job");
      expect(result.status).toBe("completed");
    });

    it("is idempotent on a cancelled job", async () => {
      const cancelledRow = {
        id: "already-cancelled",
        type: "extraction",
        status: "cancelled",
        progress: 0,
        currentStep: null,
        error: null,
        courseId: "c-1",
        materialId: "m-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        total: 100,
      };
      createdJobs.push(cancelledRow);
      mockProcessingJobFindUnique.mockImplementation(
        async ({ where }: { where: { id: string } }) =>
          createdJobs.find((j) => j.id === where.id) ?? null
      );
      const result = await service.cancel("already-cancelled");
      expect(result.status).toBe("cancelled");
    });
  });

  describe("getActiveJobs", () => {
    it("returns the jobs from the DB", async () => {
      await service.processCourse({
        courseId: "c-1",
        materialId: "m-1",
        buffer: Buffer.from("pdf"),
      });
      // The mock returns the local createdJobs array. Each row
      // already has createdAt/updatedAt from the create mock.
      const jobs = await service.getActiveJobs();
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      // Each entry has the wire shape the store expects.
      const first = jobs[0];
      expect(first).toHaveProperty("jobId");
      expect(first).toHaveProperty("phase");
      expect(first).toHaveProperty("status");
      expect(typeof first.startedAt).toBe("number");
      expect(typeof first.updatedAt).toBe("number");
    });
  });
});

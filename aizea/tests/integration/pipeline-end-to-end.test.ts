// @ts-nocheck
// Pipeline end-to-end integration test.
//
// Covers the wiring between the PrismaMaterialRepository and the
// real DB. The MaterialService that used to live in
// `lib/application/MaterialService.ts` was an anti-pattern (it
// directly instantiated PipelineService); the new design replaces
// it with a use case + composition root, so the test now exercises
// the new use case against the real DB.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const TEST_DB = join(process.cwd(), "prisma", "test-pipeline-e2e.db");
const TEST_DB_URL = `file:${TEST_DB}`;
const SAMPLE_PDF = join(process.cwd(), "tests", "fixtures", "sample.pdf");

let testDb: any;
let ProcessCourseUseCase: any;
let PrismaMaterialRepository: any;
let ProcessCourseUseCaseDeps: any;
let SlideService: any;

async function applyMigrations(db: any): Promise<void> {
  const migrationPaths = [
    join(process.cwd(), "prisma", "migrations", "20260711161501_add_pipeline_tables", "migration.sql"),
    join(process.cwd(), "prisma", "migrations", "20260711200000_add_topic_group_table", "migration.sql"),
  ];
  for (const migrationPath of migrationPaths) {
    const sql = readFileSync(migrationPath, "utf-8");
    const statements = sql.split(/;\s*\n/).map((s) => s.replace(/^--.*$/gm, "").trim()).filter((s) => s.length > 0);
    for (const stmt of statements) {
      await db.$executeRawUnsafe(stmt);
    }
  }
}

describe("Pipeline end-to-end (integration)", () => {
  beforeAll(async () => {
    for (const suffix of ["", "-journal", "-shm", "-wal"]) {
      if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
    }
    process.env.DATABASE_URL = TEST_DB_URL;
    // Point BullMQ at a closed port so the JobQueue degrades to a
    // no-op instead of retrying forever.
    process.env.REDIS_URL = "redis://127.0.0.1:1";

    const { PrismaClient } = await import("@prisma/client");
    testDb = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    await applyMigrations(testDb);
    vi.doMock("@/lib/db", () => ({ db: testDb }));

    const pc = await import("@/lib/application/use-cases/process-course.use-case");
    ProcessCourseUseCase = pc.ProcessCourseUseCase;
    ProcessCourseUseCaseDeps = pc.ProcessCourseUseCaseDeps;
    const repo = await import(
      "@/lib/infrastructure/persistence/prisma-material.repository"
    );
    PrismaMaterialRepository = repo.PrismaMaterialRepository;
    const ss = await import("@/lib/application/SlideService");
    SlideService = ss.SlideService;
  });

  afterAll(async () => {
    if (testDb) await testDb.$disconnect();
    for (const suffix of ["", "-journal", "-shm", "-wal"]) {
      if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
    }
  });

  beforeEach(async () => {
    if (!testDb) return;
    await testDb.processingJob.deleteMany({});
    await testDb.topicNode.deleteMany({});
    await testDb.topicGroup.deleteMany({});
    await testDb.unitRepresentation.deleteMany({});
    await testDb.semanticUnit.deleteMany({});
    await testDb.material.deleteMany({});
    await testDb.course.deleteMany({});
  });

  it("ProcessCourseUseCase returns NO_MATERIALS when the course has none", async () => {
    const course = await testDb.course.create({ data: { name: "E2E no-mat" } });
    const repo = new PrismaMaterialRepository();
    const useCase = new ProcessCourseUseCase({
      materials: repo,
      pipeline: { processCourse: vi.fn() } as any,
      notifier: { notify: vi.fn() } as any,
    });
    const outcome = await useCase.execute(course.id);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.empty).toBe(true);
      if (outcome.empty) {
        expect(outcome.reason).toBe("NO_MATERIALS");
        expect(outcome.message).toMatch(/sube un pdf/i);
      }
    }
  });

  it("ProcessCourseUseCase reads the buffer from disk and re-runs the pipeline when a material exists with no SemanticUnits (the docling-down case)", async () => {
    const course = await testDb.course.create({ data: { name: "E2E recovery" } });
    // Create a material with the same path the upload flow uses:
    // filename pattern is `{timestamp}_{original}`. We pre-seed
    // the file under the default uploads dir.
    const filename = `e2e-test-${Date.now()}_dummy.pdf`;
    const uploadsDir = join(process.cwd(), "public", "uploads");
    const filePath = join(uploadsDir, filename);
    // Write a tiny PDF-like buffer to disk; the repository will
    // re-read it during the use case.
    writeFileSync(filePath, Buffer.from("%PDF-1.4\n%minimal\n"));
    try {
      const material = await testDb.material.create({
        data: {
          courseId: course.id,
          filename,
          content: "pre-existing text",
          pageCount: 1,
        },
      });
      // No SemanticUnits for this material.
      const repo = new PrismaMaterialRepository();
      const pipelineCalled = { value: false, input: null as any };
      const fakePipeline = {
        processCourse: async (input: any) => {
          pipelineCalled.value = true;
          pipelineCalled.input = input;
          return {
            segmentationJobId: "seg-1",
            extractionJobId: "ext-1",
            integrationJobId: "int-1",
            treeBuildingJobId: "tree-1",
            empty: false,
            message: null,
          };
        },
      };
      const useCase = new ProcessCourseUseCase({
        materials: repo,
        pipeline: fakePipeline as any,
        notifier: { notify: vi.fn() } as any,
      });
      const outcome = await useCase.execute(course.id);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.empty).toBe(false);
      }
      expect(pipelineCalled.value).toBe(true);
      // The buffer MUST be passed so the segmenter has bytes.
      expect(Buffer.isBuffer(pipelineCalled.input.buffer)).toBe(true);
      expect(pipelineCalled.input.materialId).toBe(material.id);
    } finally {
      // Cleanup the seeded file.
      if (existsSync(filePath)) rmSync(filePath);
    }
  });

  it("end-to-end slide generation: pick 3 nodes from the tree, generate one slide per node", async () => {
    const course = await testDb.course.create({ data: { name: "E2E slides" } });
    const root = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Raíz", depth: 0, isLeaf: false, version: 1, summary: "Resumen raíz" },
    });
    const child1 = await testDb.topicNode.create({
      data: { courseId: course.id, parentId: root.id, name: "Tema 1", depth: 1, isLeaf: true, version: 1, summary: "Resumen 1" },
    });
    const child2 = await testDb.topicNode.create({
      data: { courseId: course.id, parentId: root.id, name: "Tema 2", depth: 1, isLeaf: true, version: 1, summary: "Resumen 2" },
    });
    const child3 = await testDb.topicNode.create({
      data: { courseId: course.id, parentId: root.id, name: "Tema 3", depth: 1, isLeaf: true, version: 1, summary: "Resumen 3" },
    });
    const selected = [child1.id, child2.id, child3.id];

    const reversed = [child3.id, child2.id, child1.id];
    const slideService = new SlideService({
      chatJSON: (async () => ({ order: reversed })) as never,
    } as never);

    const slides = await slideService.generateOutlineFromTree(course.id, selected);
    expect(slides).toHaveLength(3);
    expect(slides.map((s: any) => s.title)).toEqual([
      "Tema 3",
      "Tema 2",
      "Tema 1",
    ]);
    expect(slides.map((s: any) => s.description)).toEqual([
      "Resumen 3",
      "Resumen 2",
      "Resumen 1",
    ]);
    for (let i = 0; i < slides.length; i++) {
      expect(slides[i].order).toBe(i);
    }
  });

  it("captures an evidence summary to .test-artifacts/evidence/task-28-e2e.json", async () => {
    const course = await testDb.course.create({ data: { name: "E2E evidence" } });
    const root = await testDb.topicNode.create({
      data: { courseId: course.id, name: "X", depth: 0, isLeaf: true, version: 1, summary: "S" },
    });
    const slideService = new SlideService({
      chatJSON: (async () => ({ order: [root.id] })) as never,
    } as never);
    const slides = await slideService.generateOutlineFromTree(course.id, [root.id]);

    const evidence = {
      courseId: course.id,
      nodeCount: 1,
      slideCount: slides.length,
      nodes: [{ id: root.id, name: root.name, depth: root.depth }],
      slides: slides.map((s: any) => ({ id: s.id, title: s.title, order: s.order })),
    };
    const evidenceDir = join(process.cwd(), ".test-artifacts", "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      join(evidenceDir, "task-28-e2e.json"),
      JSON.stringify(evidence, null, 2)
    );
    expect(existsSync(join(evidenceDir, "task-28-e2e.json"))).toBe(true);
  });
});

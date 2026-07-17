import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const TEST_DB = join(process.cwd(), "prisma", "test-pipeline-tables.db");
const TEST_DB_URL = `file:${TEST_DB}`;
const MIGRATION_SQL = join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260711161501_add_pipeline_tables",
  "migration.sql"
);

let db: PrismaClient;

beforeAll(async () => {
  if (existsSync(TEST_DB)) {
    rmSync(TEST_DB, { force: true });
  }
  if (existsSync(`${TEST_DB}-journal`)) {
    rmSync(`${TEST_DB}-journal`, { force: true });
  }
  process.env.DATABASE_URL = TEST_DB_URL;
  db = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  // Apply schema by executing the migration SQL directly.
  // This bypasses prisma CLI's .env auto-loading, which would always target dev.db.
  const sql = readFileSync(MIGRATION_SQL, "utf-8");
  // SQLite via $executeRawUnsafe doesn't run multi-statement scripts, so split on ";\n" boundaries
  // and execute each statement. Keeps comments out of executable statements.
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await db.$executeRawUnsafe(stmt);
  }
});

afterAll(async () => {
  if (db) await db.$disconnect();
  if (existsSync(TEST_DB)) {
    rmSync(TEST_DB, { force: true });
  }
});

describe("Pipeline tables — Prisma schema", () => {
  it("can create and read a Settings row (singleton id='default')", async () => {
    const created = await db.settings.create({
      data: {
        id: "default",
        openrouterApiKey: "sk-test-key",
        chatModel: "deepseek/deepseek-chat",
        embedModel: "openai/text-embedding-3-small",
      },
    });
    expect(created.id).toBe("default");
    expect(created.openrouterApiKey).toBe("sk-test-key");

    const fetched = await db.settings.findUnique({ where: { id: "default" } });
    expect(fetched?.chatModel).toBe("deepseek/deepseek-chat");
  });

  it("can create and read a SemanticUnit with materialId", async () => {
    const course = await db.course.create({ data: { name: "Test course" } });
    const material = await db.material.create({
      data: {
        courseId: course.id,
        filename: "test.pdf",
        content: "",
        pageCount: 10,
      },
    });

    const unit = await db.semanticUnit.create({
      data: {
        materialId: material.id,
        content: "Some text from the unit",
        order: 0,
      },
    });

    expect(unit.id).toBeDefined();
    expect(unit.materialId).toBe(material.id);
    expect(unit.content).toBe("Some text from the unit");
    expect(unit.order).toBe(0);

    const fetched = await db.semanticUnit.findUnique({
      where: { id: unit.id },
    });
    expect(fetched?.content).toBe("Some text from the unit");
  });

  it("can create and read a UnitRepresentation linked to SemanticUnit (1:1)", async () => {
    const course = await db.course.create({ data: { name: "Test course" } });
    const material = await db.material.create({
      data: { courseId: course.id, filename: "t.pdf", content: "", pageCount: 1 },
    });
    const unit = await db.semanticUnit.create({
      data: { materialId: material.id, content: "x", order: 0 },
    });

    const repr = await db.unitRepresentation.create({
      data: {
        unitId: unit.id,
        concepts: JSON.stringify([{ name: "Entropy", importance: 0.9 }]),
        mainIdeas: JSON.stringify(["Energy is conserved"]),
        formulas: JSON.stringify([]),
        figures: JSON.stringify([]),
        prerequisites: JSON.stringify([]),
        introduces: JSON.stringify([]),
      },
    });

    expect(repr.unitId).toBe(unit.id);
    const fetched = await db.unitRepresentation.findUnique({
      where: { unitId: unit.id },
    });
    expect(fetched?.concepts).toContain("Entropy");
  });

  it("can create TopicNode with self-referencing parent (tree structure)", async () => {
    const course = await db.course.create({ data: { name: "Test course" } });

    const root = await db.topicNode.create({
      data: {
        courseId: course.id,
        parentId: null,
        name: "Physics",
        summary: "All physics topics",
        depth: 0,
        version: 1,
        isLeaf: false,
      },
    });

    const child = await db.topicNode.create({
      data: {
        courseId: course.id,
        parentId: root.id,
        name: "Thermodynamics",
        summary: "Heat and energy",
        depth: 1,
        version: 1,
        isLeaf: true,
      },
    });

    expect(child.parentId).toBe(root.id);
    expect(child.isLeaf).toBe(true);

    const children = await db.topicNode.findMany({
      where: { parentId: root.id },
    });
    expect(children.length).toBe(1);
    expect(children[0].name).toBe("Thermodynamics");
  });

  it("can create and read a ProcessingJob tracking pipeline progress", async () => {
    const job = await db.processingJob.create({
      data: {
        id: "job-test-1",
        type: "segmentation",
        status: "running",
        progress: 0,
        total: 100,
        currentStep: "starting",
      },
    });

    expect(job.id).toBe("job-test-1");
    expect(job.type).toBe("segmentation");
    expect(job.status).toBe("running");

    // Update progress
    const updated = await db.processingJob.update({
      where: { id: "job-test-1" },
      data: { progress: 50, currentStep: "halfway" },
    });
    expect(updated.progress).toBe(50);
  });

  it("deletes TopicNodes when Course is deleted (cascade)", async () => {
    const course = await db.course.create({ data: { name: "To delete" } });
    await db.topicNode.create({
      data: {
        courseId: course.id,
        name: "Root",
        depth: 0,
        version: 1,
      },
    });

    await db.course.delete({ where: { id: course.id } });

    const remaining = await db.topicNode.findMany({
      where: { courseId: course.id },
    });
    expect(remaining.length).toBe(0);
  });

  it("deletes SemanticUnits when Material is deleted (cascade)", async () => {
    const course = await db.course.create({ data: { name: "Test" } });
    const material = await db.material.create({
      data: { courseId: course.id, filename: "x.pdf", content: "", pageCount: 1 },
    });
    await db.semanticUnit.create({
      data: { materialId: material.id, content: "x", order: 0 },
    });

    await db.material.delete({ where: { id: material.id } });

    const remaining = await db.semanticUnit.findMany({
      where: { materialId: material.id },
    });
    expect(remaining.length).toBe(0);
  });

  it("deletes UnitRepresentation when SemanticUnit is deleted (cascade)", async () => {
    const course = await db.course.create({ data: { name: "Test" } });
    const material = await db.material.create({
      data: { courseId: course.id, filename: "x.pdf", content: "", pageCount: 1 },
    });
    const unit = await db.semanticUnit.create({
      data: { materialId: material.id, content: "x", order: 0 },
    });
    await db.unitRepresentation.create({
      data: { unitId: unit.id },
    });

    await db.semanticUnit.delete({ where: { id: unit.id } });

    const remaining = await db.unitRepresentation.findMany({
      where: { unitId: unit.id },
    });
    expect(remaining.length).toBe(0);
  });
});

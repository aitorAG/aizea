import { describe, it, expect, afterEach } from "vitest";
import { db } from "@/lib/db";

const createdMaterialIds: string[] = [];
const createdCourseIds: string[] = [];

async function makeFixture() {
  const course = await db.course.create({
    data: { name: `test-chunk-course-${Date.now()}` },
  });
  createdCourseIds.push(course.id);

  const material = await db.material.create({
    data: {
      courseId: course.id,
      filename: "test.txt",
      content: "raw material content",
    },
  });
  createdMaterialIds.push(material.id);

  return { course, material };
}

afterEach(async () => {
  for (const id of createdMaterialIds.splice(0)) {
    await db.textChunk.deleteMany({ where: { materialId: id } }).catch(() => {});
    await db.material.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdCourseIds.splice(0)) {
    await db.course.delete({ where: { id } }).catch(() => {});
  }
});

describe("TextChunk CRUD", () => {
  it("creates a TextChunk and persists all fields", async () => {
    const { material } = await makeFixture();

    const chunk = await db.textChunk.create({
      data: {
        materialId: material.id,
        chunkIndex: 0,
        content: "First chunk of text.",
        embedding: "[0.1, 0.2, 0.3]",
        tokenCount: 5,
      },
    });

    expect(chunk.id).toBeTypeOf("string");
    expect(chunk.materialId).toBe(material.id);
    expect(chunk.chunkIndex).toBe(0);
    expect(chunk.content).toBe("First chunk of text.");
    expect(chunk.embedding).toBe("[0.1, 0.2, 0.3]");
    expect(chunk.tokenCount).toBe(5);
  });

  it("stores null embedding when not provided", async () => {
    const { material } = await makeFixture();

    const chunk = await db.textChunk.create({
      data: {
        materialId: material.id,
        chunkIndex: 1,
        content: "No embedding yet.",
        tokenCount: 3,
      },
    });

    expect(chunk.embedding).toBeNull();
    expect(chunk.chunkIndex).toBe(1);
  });

  it("queries TextChunks by materialId ordered by chunkIndex", async () => {
    const { material } = await makeFixture();

    await db.textChunk.create({
      data: { materialId: material.id, chunkIndex: 2, content: "third", tokenCount: 1 },
    });
    await db.textChunk.create({
      data: { materialId: material.id, chunkIndex: 0, content: "first", tokenCount: 1 },
    });
    await db.textChunk.create({
      data: { materialId: material.id, chunkIndex: 1, content: "second", tokenCount: 1 },
    });

    const chunks = await db.textChunk.findMany({
      where: { materialId: material.id },
      orderBy: { chunkIndex: "asc" },
    });

    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2]);
    expect(chunks.map((c) => c.content)).toEqual(["first", "second", "third"]);
  });

  it("updates a TextChunk content", async () => {
    const { material } = await makeFixture();

    const chunk = await db.textChunk.create({
      data: {
        materialId: material.id,
        chunkIndex: 0,
        content: "original",
        tokenCount: 1,
      },
    });

    const updated = await db.textChunk.update({
      where: { id: chunk.id },
      data: { content: "updated content", tokenCount: 2 },
    });

    expect(updated.content).toBe("updated content");
    expect(updated.tokenCount).toBe(2);
    expect(updated.chunkIndex).toBe(0);
  });

  it("deletes a TextChunk", async () => {
    const { material } = await makeFixture();

    const chunk = await db.textChunk.create({
      data: {
        materialId: material.id,
        chunkIndex: 0,
        content: "to be deleted",
        tokenCount: 3,
      },
    });

    await db.textChunk.delete({ where: { id: chunk.id } });

    const found = await db.textChunk.findUnique({ where: { id: chunk.id } });
    expect(found).toBeNull();
  });

  it("cascades delete when Material is removed", async () => {
    const { material } = await makeFixture();

    await db.textChunk.create({
      data: { materialId: material.id, chunkIndex: 0, content: "c", tokenCount: 1 },
    });
    await db.textChunk.create({
      data: { materialId: material.id, chunkIndex: 1, content: "d", tokenCount: 1 },
    });

    await db.material.delete({ where: { id: material.id } });
    createdMaterialIds.splice(createdMaterialIds.indexOf(material.id), 1);

    const remaining = await db.textChunk.findMany({
      where: { materialId: material.id },
    });
    expect(remaining).toHaveLength(0);
  });
});

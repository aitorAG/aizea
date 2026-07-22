import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

const TEST_DB = join(process.cwd(), "prisma", "test-actions-tree.db");
const TEST_DB_URL = `file:${TEST_DB}`;
const MIGRATION_SQL = join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260711161501_add_pipeline_tables",
  "migration.sql"
);
const MIGRATION_TOPIC_GROUP_SQL = join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260711200000_add_topic_group_table",
  "migration.sql"
);

for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
}
process.env.DATABASE_URL = TEST_DB_URL;

const testDb = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
for (const migrationPath of [MIGRATION_SQL, MIGRATION_TOPIC_GROUP_SQL]) {
  const sql = readFileSync(migrationPath, "utf-8");
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
  for (const stmt of statements) {
    await testDb.$executeRawUnsafe(stmt);
  }
}

vi.mock("@/lib/db", () => ({ db: testDb }));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

// Mock the LLM client so the Split action can be exercised without
// hitting OpenRouter. `splitTreeNodeAction` calls chatJSON to
// propose sub-contents; tests control the response via mockChatJSON.
const { mockChatJSON, mockChat } = vi.hoisted(() => ({
  mockChatJSON: vi.fn(),
  mockChat: vi.fn(),
}));

vi.mock("@/lib/domain/llm/LLMClient", () => ({
  chatJSON: mockChatJSON,
  chat: mockChat,
}));

let getCourseTreeAction: typeof import("@/lib/actions/tree").getCourseTreeAction;
let updateTreeNodeAction: typeof import("@/lib/actions/tree").updateTreeNodeAction;
let deleteTreeNodeAction: typeof import("@/lib/actions/tree").deleteTreeNodeAction;
let mergeTreeNodesAction: typeof import("@/lib/actions/tree").mergeTreeNodesAction;
let splitTreeNodeAction: typeof import("@/lib/actions/tree").splitTreeNodeAction;
let addTreeNodeAction: typeof import("@/lib/actions/tree").addTreeNodeAction;

beforeAll(async () => {
  const mod = await import("@/lib/actions/tree");
  getCourseTreeAction = mod.getCourseTreeAction;
  updateTreeNodeAction = mod.updateTreeNodeAction;
  deleteTreeNodeAction = mod.deleteTreeNodeAction;
  mergeTreeNodesAction = mod.mergeTreeNodesAction;
  splitTreeNodeAction = mod.splitTreeNodeAction;
  addTreeNodeAction = mod.addTreeNodeAction;
});

afterAll(async () => {
  await testDb.$disconnect();
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    if (existsSync(TEST_DB + suffix)) rmSync(TEST_DB + suffix, { force: true });
  }
});

beforeEach(async () => {
  await testDb.topicNode.deleteMany({});
  await testDb.topicGroup.deleteMany({});
  await testDb.course.deleteMany({});
});

describe("getCourseTreeAction", () => {
  it("returns an empty array when the course has no tree", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const result = await getCourseTreeAction(course.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tree).toEqual([]);
    }
  });

  it("returns all TopicNodes for the course", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    await testDb.topicNode.create({
      data: { courseId: course.id, name: "Root", depth: 0, version: 1, isLeaf: false },
    });
    await testDb.topicNode.create({
      data: { courseId: course.id, name: "Child", depth: 1, version: 1, isLeaf: true },
    });
    const result = await getCourseTreeAction(course.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tree.length).toBe(2);
    }
  });

  it("returns ok:false when the course does not exist", async () => {
    const result = await getCourseTreeAction("non-existent");
    expect(result.ok).toBe(false);
  });
});

describe("updateTreeNodeAction", () => {
  it("updates the node's name and summary", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const node = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Old name", summary: "Old summary", depth: 0, version: 1, isLeaf: false },
    });
    const result = await updateTreeNodeAction(node.id, {
      name: "New name",
      summary: "New summary",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.node.name).toBe("New name");
      expect(result.node.summary).toBe("New summary");
    }
    const dbNode = await testDb.topicNode.findUnique({ where: { id: node.id } });
    expect(dbNode?.name).toBe("New name");
    expect(dbNode?.summary).toBe("New summary");
  });

  it("rejects when the node does not exist", async () => {
    const result = await updateTreeNodeAction("non-existent", { name: "x" });
    expect(result.ok).toBe(false);
  });

  it("rejects when name is empty", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const node = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Real", depth: 0, version: 1 },
    });
    const result = await updateTreeNodeAction(node.id, { name: "  " });
    expect(result.ok).toBe(false);
  });
});

describe("deleteTreeNodeAction", () => {
  it("deletes the node and reassigns its children to the grandparent", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const root = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Root", depth: 0, version: 1 },
    });
    const mid = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Mid", parentId: root.id, depth: 1, version: 1 },
    });
    const leaf = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Leaf", parentId: mid.id, depth: 2, version: 1 },
    });

    const result = await deleteTreeNodeAction(mid.id);
    expect(result.ok).toBe(true);

    // mid is gone
    const midAfter = await testDb.topicNode.findUnique({ where: { id: mid.id } });
    expect(midAfter).toBeNull();
    // leaf is now a child of root
    const leafAfter = await testDb.topicNode.findUnique({ where: { id: leaf.id } });
    expect(leafAfter?.parentId).toBe(root.id);
  });

  it("orphans children to null when the deleted node was a root", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const root = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Root", depth: 0, version: 1 },
    });
    const child = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Child", parentId: root.id, depth: 1, version: 1 },
    });
    const result = await deleteTreeNodeAction(root.id);
    expect(result.ok).toBe(true);
    const childAfter = await testDb.topicNode.findUnique({ where: { id: child.id } });
    expect(childAfter?.parentId).toBeNull();
  });

  it("returns ok:false when the node does not exist", async () => {
    const result = await deleteTreeNodeAction("non-existent");
    expect(result.ok).toBe(false);
  });
});

describe("mergeTreeNodesAction", () => {
  it("merges the given children into a new node under the parent", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const parent = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Parent", depth: 0, version: 1 },
    });
    const c1 = await testDb.topicNode.create({
      data: { courseId: course.id, name: "C1", parentId: parent.id, depth: 1, version: 1, summary: "d1" },
    });
    const c2 = await testDb.topicNode.create({
      data: { courseId: course.id, name: "C2", parentId: parent.id, depth: 1, version: 1, summary: "d2" },
    });

    const result = await mergeTreeNodesAction(parent.id, [c1.id, c2.id], "Merged");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.node.name).toBe("Merged");
      expect(result.node.parentId).toBe(parent.id);
    }
    // Original children are deleted
    const after1 = await testDb.topicNode.findUnique({ where: { id: c1.id } });
    const after2 = await testDb.topicNode.findUnique({ where: { id: c2.id } });
    expect(after1).toBeNull();
    expect(after2).toBeNull();
  });

  it("rejects when one of the childIds does not exist", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const parent = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Parent", depth: 0, version: 1 },
    });
    const result = await mergeTreeNodesAction(parent.id, ["non-existent"], "X");
    expect(result.ok).toBe(false);
  });

  it("rejects with empty childIds", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const parent = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Parent", depth: 0, version: 1 },
    });
    const result = await mergeTreeNodesAction(parent.id, [], "X");
    expect(result.ok).toBe(false);
  });
});

describe("splitTreeNodeAction", () => {
  beforeEach(() => {
    mockChatJSON.mockReset();
  });

  it("rejects when the node does not exist", async () => {
    mockChatJSON.mockResolvedValue({ subcontents: [] });
    const result = await splitTreeNodeAction("non-existent");
    expect(result.ok).toBe(false);
  });

  it("creates one child per sub-content proposed by the LLM (default happy path)", async () => {
    mockChatJSON.mockResolvedValue({
      subcontents: [
        { name: "Sub A", summary: "Desc A" },
        { name: "Sub B", summary: "Desc B" },
        { name: "Sub C", summary: "Desc C" },
      ],
    });
    const course = await testDb.course.create({ data: { name: "Test" } });
    const node = await testDb.topicNode.create({
      data: {
        courseId: course.id,
        name: "Padre",
        depth: 0,
        version: 1,
        summary: "Resumen del padre",
      },
    });
    const result = await splitTreeNodeAction(node.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nodes.length).toBe(3);
      const names = result.nodes.map((n) => n.name);
      expect(names).toEqual(["Sub A", "Sub B", "Sub C"]);
      for (const child of result.nodes) {
        expect(child.parentId).toBe(node.id);
        expect(child.depth).toBe(1);
      }
    }
  });

  it("sends a prompt that includes the node name and summary to the LLM", async () => {
    mockChatJSON.mockResolvedValue({
      subcontents: [
        { name: "A", summary: "a" },
        { name: "B", summary: "b" },
      ],
    });
    const course = await testDb.course.create({ data: { name: "Test" } });
    const node = await testDb.topicNode.create({
      data: {
        courseId: course.id,
        name: "Termodinámica",
        depth: 0,
        version: 1,
        summary: "Calor y energía",
      },
    });
    await splitTreeNodeAction(node.id);
    expect(mockChatJSON).toHaveBeenCalledTimes(1);
    const messages = mockChatJSON.mock.calls[0][0] as Array<{
      role: string;
      content: string;
    }>;
    const user = messages.find((m) => m.role === "user");
    expect(user).toBeDefined();
    expect(user!.content).toContain("Termodinámica");
    expect(user!.content).toContain("Calor y energía");
  });

  it("clamps the number of children to at most 5 even if the LLM proposes more", async () => {
    mockChatJSON.mockResolvedValue({
      subcontents: [
        { name: "A", summary: "a" },
        { name: "B", summary: "b" },
        { name: "C", summary: "c" },
        { name: "D", summary: "d" },
        { name: "E", summary: "e" },
        { name: "F", summary: "f" },
        { name: "G", summary: "g" },
      ],
    });
    const course = await testDb.course.create({ data: { name: "Test" } });
    const node = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Padre", depth: 0, version: 1 },
    });
    const result = await splitTreeNodeAction(node.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nodes.length).toBe(5);
    }
  });

  it("falls back to a single child with the original content when the LLM returns an empty array", async () => {
    mockChatJSON.mockResolvedValue({ subcontents: [] });
    const course = await testDb.course.create({ data: { name: "Test" } });
    const node = await testDb.topicNode.create({
      data: {
        courseId: course.id,
        name: "Padre",
        summary: "Resumen",
        depth: 0,
        version: 1,
      },
    });
    const result = await splitTreeNodeAction(node.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0].name).toBe("Padre");
      expect(result.nodes[0].summary).toBe("Resumen");
      expect(result.nodes[0].parentId).toBe(node.id);
    }
  });

  it("falls back to a single child when the LLM throws", async () => {
    mockChatJSON.mockRejectedValue(new Error("OpenRouter down"));
    const course = await testDb.course.create({ data: { name: "Test" } });
    const node = await testDb.topicNode.create({
      data: {
        courseId: course.id,
        name: "Padre",
        summary: "Resumen",
        depth: 0,
        version: 1,
      },
    });
    const result = await splitTreeNodeAction(node.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nodes.length).toBe(1);
      expect(result.nodes[0].name).toBe("Padre");
    }
  });

  it("flips the original node's isLeaf to false after the split", async () => {
    mockChatJSON.mockResolvedValue({
      subcontents: [
        { name: "A", summary: "a" },
        { name: "B", summary: "b" },
      ],
    });
    const course = await testDb.course.create({ data: { name: "Test" } });
    const node = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Padre", depth: 0, version: 1, isLeaf: true },
    });
    await splitTreeNodeAction(node.id);
    const after = await testDb.topicNode.findUnique({ where: { id: node.id } });
    expect(after?.isLeaf).toBe(false);
  });
});

describe("addTreeNodeAction", () => {
  it("adds a new node under the given parent", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const parent = await testDb.topicNode.create({
      data: { courseId: course.id, name: "Parent", depth: 0, version: 1 },
    });
    const result = await addTreeNodeAction(course.id, parent.id, {
      name: "New child",
      summary: "desc",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.node.name).toBe("New child");
      expect(result.node.parentId).toBe(parent.id);
      expect(result.node.depth).toBe(1);
    }
  });

  it("adds a new root node when parentId is null", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const result = await addTreeNodeAction(course.id, null, { name: "New root" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.node.parentId).toBeNull();
      expect(result.node.depth).toBe(0);
    }
  });

  it("rejects when the course does not exist", async () => {
    const result = await addTreeNodeAction("non-existent", null, { name: "x" });
    expect(result.ok).toBe(false);
  });

  it("rejects when the parent does not exist", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const result = await addTreeNodeAction(course.id, "non-existent", { name: "x" });
    expect(result.ok).toBe(false);
  });

  it("rejects when name is empty", async () => {
    const course = await testDb.course.create({ data: { name: "Test" } });
    const result = await addTreeNodeAction(course.id, null, { name: "  " });
    expect(result.ok).toBe(false);
  });
});

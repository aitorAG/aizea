import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockChatJSON,
  mockBuildBuildTreePrompt,
  mockTopicGroupFindMany,
  mockTopicNodeDeleteMany,
  mockTopicNodeCreate,
  mockTopicNodeFindFirst,
  mockTopicNodeFindMany,
} = vi.hoisted(() => ({
  mockChatJSON: vi.fn(),
  mockBuildBuildTreePrompt: vi.fn(),
  mockTopicGroupFindMany: vi.fn(),
  mockTopicNodeDeleteMany: vi.fn(),
  mockTopicNodeCreate: vi.fn(),
  mockTopicNodeFindFirst: vi.fn(),
  mockTopicNodeFindMany: vi.fn(),
}));

vi.mock("@/lib/domain/llm/LLMClient", () => ({
  chatJSON: mockChatJSON,
  chat: vi.fn(),
}));

vi.mock("@/lib/domain/prompts/PromptManager", () => ({
  PromptManager: class MockPromptManager {
    buildBuildTreePrompt = mockBuildBuildTreePrompt;
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    topicGroup: {
      findMany: mockTopicGroupFindMany,
    },
    topicNode: {
      create: mockTopicNodeCreate,
      deleteMany: mockTopicNodeDeleteMany,
      findFirst: mockTopicNodeFindFirst,
      findMany: mockTopicNodeFindMany,
    },
  },
}));

import { TreeBuilder } from "@/lib/domain/pipeline/TreeBuilder";
import type { TopicGroup, TopicNode } from "@/lib/types/pipeline";

describe("TreeBuilder", () => {
  let builder: TreeBuilder;
  let createdNodes: Map<string, { id: string; parentId: string | null; depth: number; version: number; name: string; summary: string | null; isLeaf: boolean; courseId: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    builder = new TreeBuilder();
    createdNodes = new Map();
    mockBuildBuildTreePrompt.mockReturnValue({ system: "SYS", user: "USR" });
    mockTopicGroupFindMany.mockResolvedValue([]);
    mockTopicNodeDeleteMany.mockResolvedValue({ count: 0 });
    mockTopicNodeFindFirst.mockResolvedValue(null); // No previous version → use 1
    mockTopicNodeFindMany.mockResolvedValue([]);

    // Each create() returns a row with a generated id; the implementation
    // also needs the id to be predictable for parentRef resolution. We
    // assign sequential ids.
    let counter = 0;
    mockTopicNodeCreate.mockImplementation(
      async ({ data }: { data: { name: string; summary: string | null; depth: number; parentId: string | null; isLeaf: boolean; version: number; courseId: string } }) => {
        counter++;
        const id = `node-${counter}`;
        const row = {
          id,
          parentId: data.parentId,
          depth: data.depth,
          version: data.version,
          name: data.name,
          summary: data.summary,
          isLeaf: data.isLeaf,
          courseId: data.courseId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        createdNodes.set(id, row);
        return row;
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("input loading", () => {
    it("loads all TopicGroups for the course", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "G1", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [
          { ref: "g-1", name: "G1", summary: "d", parentRef: null, depth: 0 },
        ],
        roots: ["g-1"],
      });
      await builder.build("c-1");
      expect(mockTopicGroupFindMany).toHaveBeenCalled();
    });

    it("returns an empty array when there are no TopicGroups", async () => {
      mockTopicGroupFindMany.mockResolvedValue([]);
      const result = await builder.build("c-1");
      expect(result).toEqual([]);
      expect(mockChatJSON).not.toHaveBeenCalled();
    });
  });

  describe("LLM integration", () => {
    it("calls PromptManager.buildBuildTreePrompt with the TopicGroups", async () => {
      const groups: TopicGroup[] = [
        { id: "g-1", name: "G1", description: "d", importance: 0.5, concepts: [], sourceUnitIds: [] },
      ];
      mockTopicGroupFindMany.mockResolvedValue(
        groups.map((g) => ({ ...g, concepts: "[]", sourceUnitIds: "[]", version: 1, courseId: "c-1", createdAt: new Date(), updatedAt: new Date() }))
      );
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "G1", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      await builder.build("c-1");
      expect(mockBuildBuildTreePrompt).toHaveBeenCalled();
    });

    it("calls LLMClient.chatJSON with the prompt messages", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "G1", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockBuildBuildTreePrompt.mockReturnValue({
        system: "SYS-MARKER",
        user: "USR-MARKER",
      });
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "G1", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      await builder.build("c-1");
      expect(mockChatJSON).toHaveBeenCalledWith([
        { role: "system", content: "SYS-MARKER" },
        { role: "user", content: "USR-MARKER" },
      ]);
    });

    it("propagates LLM errors", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "G1", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockRejectedValue(new Error("LLM 503"));
      await expect(builder.build("c-1")).rejects.toThrow(/LLM 503/);
    });
  });

  describe("tree construction", () => {
    it("builds a valid tree from 3 TopicGroups (one root, two children)", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "Root", description: "d", importance: 0.9, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-2", courseId: "c-1", name: "Child1", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-3", courseId: "c-1", name: "Child2", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [
          { ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 },
          { ref: "g-2", name: "Child1", summary: "d", parentRef: "g-1", depth: 1 },
          { ref: "g-3", name: "Child2", summary: "d", parentRef: "g-1", depth: 1 },
        ],
        roots: ["g-1"],
      });

      const result = await builder.build("c-1");
      expect(result).toHaveLength(3);
      const root = result.find((n) => n.parentId === null);
      expect(root).toBeDefined();
      const children = result.filter((n) => n.parentId === root?.id);
      expect(children).toHaveLength(2);
    });

    it("returns nodes with valid IDs and parentId references (no orphans)", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "Root", description: "d", importance: 0.9, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-2", courseId: "c-1", name: "Child", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [
          { ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 },
          { ref: "g-2", name: "Child", summary: "d", parentRef: "g-1", depth: 1 },
        ],
        roots: ["g-1"],
      });

      const result = await builder.build("c-1");
      const ids = new Set(result.map((n) => n.id));
      for (const n of result) {
        if (n.parentId !== null) {
          expect(ids.has(n.parentId)).toBe(true);
        }
      }
    });

    it("enforces a maximum depth of 4 (depth 0..3)", async () => {
      // Build a chain of 10 nodes — the builder should reject any deeper than depth 3.
      mockTopicGroupFindMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `g-${i}`,
          courseId: "c-1",
          name: `Node${i}`,
          description: "d",
          importance: 0.5,
          concepts: "[]",
          sourceUnitIds: "[]",
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        }))
      );
      mockChatJSON.mockResolvedValue({
        nodes: Array.from({ length: 10 }, (_, i) => ({
          ref: `g-${i}`,
          name: `Node${i}`,
          summary: "d",
          parentRef: i === 0 ? null : `g-${i - 1}`,
          depth: i,
        })),
        roots: ["g-0"],
      });
      await expect(builder.build("c-1")).rejects.toThrow(/depth|profundidad|cycle|ciclo/i);
    });

    it("marks leaves correctly (nodes with no children have isLeaf=true)", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "Root", description: "d", importance: 0.9, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-2", courseId: "c-1", name: "Leaf1", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-3", courseId: "c-1", name: "Leaf2", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [
          { ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 },
          { ref: "g-2", name: "Leaf1", summary: "d", parentRef: "g-1", depth: 1 },
          { ref: "g-3", name: "Leaf2", summary: "d", parentRef: "g-1", depth: 1 },
        ],
        roots: ["g-1"],
      });

      const result = await builder.build("c-1");
      const root = result.find((n) => n.parentId === null);
      expect(root?.isLeaf).toBe(false);
      const children = result.filter((n) => n.parentId === root?.id);
      for (const c of children) {
        expect(c.isLeaf).toBe(true);
      }
    });
  });

  describe("cycle detection", () => {
    it("rejects a hierarchy containing a cycle (A → B → A)", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "A", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-2", courseId: "c-1", name: "B", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      // Direct cycle: A's parentRef is B, B's parentRef is A
      mockChatJSON.mockResolvedValue({
        nodes: [
          { ref: "g-1", name: "A", summary: "d", parentRef: "g-2", depth: 0 },
          { ref: "g-2", name: "B", summary: "d", parentRef: "g-1", depth: 1 },
        ],
        roots: ["g-1"],
      });
      await expect(builder.build("c-1")).rejects.toThrow(/cycle|ciclo/i);
    });

    it("rejects a self-referencing node (A → A)", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "A", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [
          { ref: "g-1", name: "A", summary: "d", parentRef: "g-1", depth: 0 },
        ],
        roots: ["g-1"],
      });
      await expect(builder.build("c-1")).rejects.toThrow(/cycle|ciclo/i);
    });

    it("rejects an indirect cycle (A → B → C → A)", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "A", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-2", courseId: "c-1", name: "B", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-3", courseId: "c-1", name: "C", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [
          { ref: "g-1", name: "A", summary: "d", parentRef: "g-3", depth: 0 },
          { ref: "g-2", name: "B", summary: "d", parentRef: "g-1", depth: 1 },
          { ref: "g-3", name: "C", summary: "d", parentRef: "g-2", depth: 2 },
        ],
        roots: ["g-1"],
      });
      await expect(builder.build("c-1")).rejects.toThrow(/cycle|ciclo/i);
    });
  });

  describe("versioning", () => {
    it("uses version 1 for the first build", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "Root", description: "d", importance: 0.9, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      mockTopicNodeFindFirst.mockResolvedValue(null);
      await builder.build("c-1");
      expect(mockTopicNodeCreate).toHaveBeenCalled();
      const data = mockTopicNodeCreate.mock.calls[0][0].data;
      expect(data.version).toBe(1);
    });

    it("increments the version on subsequent builds", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "Root", description: "d", importance: 0.9, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      // Previous build returned version 3
      mockTopicNodeFindFirst.mockResolvedValue({ version: 3 });
      await builder.build("c-1");
      const data = mockTopicNodeCreate.mock.calls[0][0].data;
      expect(data.version).toBe(4);
    });
  });

  describe("persistence", () => {
    it("persists each node to the database with self-referencing parentId", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "Root", description: "d", importance: 0.9, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: "g-2", courseId: "c-1", name: "Child", description: "d", importance: 0.5, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [
          { ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 },
          { ref: "g-2", name: "Child", summary: "d", parentRef: "g-1", depth: 1 },
        ],
        roots: ["g-1"],
      });
      await builder.build("c-1");
      // 2 creates for the 2 nodes
      expect(mockTopicNodeCreate).toHaveBeenCalledTimes(2);
      // First call: root (parentId null)
      const firstData = mockTopicNodeCreate.mock.calls[0][0].data;
      expect(firstData.parentId).toBeNull();
      expect(firstData.courseId).toBe("c-1");
      // Second call: child (parentId = root's id)
      const secondData = mockTopicNodeCreate.mock.calls[1][0].data;
      expect(secondData.parentId).not.toBeNull();
      // parentId should match the first node's id
      expect(secondData.parentId).toBe(firstData.parentId === null ? createdNodes.keys().next().value : firstData.parentId);
    });

    it("returns TopicNode objects with database-assigned ids", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "Root", description: "d", importance: 0.9, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      const result = await builder.build("c-1");
      for (const n of result) {
        expect(n.id).toBeTruthy();
        expect(typeof n.id).toBe("string");
      }
    });

    it("deletes old TopicNodes for the course before rebuilding (versioning)", async () => {
      mockTopicGroupFindMany.mockResolvedValue([
        { id: "g-1", courseId: "c-1", name: "Root", description: "d", importance: 0.9, concepts: "[]", sourceUnitIds: "[]", version: 1, createdAt: new Date(), updatedAt: new Date() },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      await builder.build("c-1");
      expect(mockTopicNodeDeleteMany).toHaveBeenCalledWith({ where: { courseId: "c-1" } });
    });
  });
});

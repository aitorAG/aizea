import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockChatJSON, mockBuildBuildTreePrompt } = vi.hoisted(() => ({
  mockChatJSON: vi.fn(),
  mockBuildBuildTreePrompt: vi.fn(),
}));

vi.mock("@/lib/domain/prompts/PromptManager", () => ({
  PromptManager: class MockPromptManager {
    buildBuildTreePrompt = mockBuildBuildTreePrompt;
  },
}));

import { TreeBuilder } from "@/lib/domain/pipeline/TreeBuilder";
import type { TopicGroup } from "@/lib/types/pipeline";
import type {
  BatchTopicNodeInput,
  CreatedTopicNodeRow,
  CreateTopicNodeInput,
  ITreeBuilderRepository,
  TreeBuilderGroupRow,
  UnitSectionPathRow,
} from "@/lib/application/ports/tree-builder-repository.port";
import type { ILLMProvider } from "@/lib/application/ports/llm-provider.port";

// ----- fake LLM provider -----
//
// La inversión DI (Fase 1) hace que TreeBuilder dependa de `ILLMProvider`
// inyectado en vez de la función libre `chatJSON`. El test inyecta este fake.
const fakeLlm: ILLMProvider = {
  chatJSON: mockChatJSON,
  chat: vi.fn(),
  name: "fake-llm",
};

// ----- fake repository -----
//
// La purificación del dominio (Fase 1) hace que TreeBuilder dependa de
// `ITreeBuilderRepository` en vez de Prisma. El test inyecta este fake en
// lugar de mockear `@/lib/db`.
function createFakeRepo() {
  return {
    findTopicGroupsByCourse:
      vi.fn<(courseId: string) => Promise<TreeBuilderGroupRow[]>>(),
    findLatestVersion: vi.fn<(courseId: string) => Promise<number | null>>(),
    deleteNodesByCourse: vi.fn<(courseId: string) => Promise<void>>(),
    createNode:
      vi.fn<(data: CreateTopicNodeInput) => Promise<CreatedTopicNodeRow>>(),
    findSectionPathsByUnitIds:
      vi.fn<(unitIds: string[]) => Promise<UnitSectionPathRow[]>>(),
    replaceCourseNodes:
      vi.fn<
        (
          courseId: string,
          nodes: BatchTopicNodeInput[]
        ) => Promise<CreatedTopicNodeRow[]>
      >(),
  } satisfies ITreeBuilderRepository;
}

/** Build a group row as the port returns it (concepts/sourceUnitIds JSON). */
function makeGroupRow(
  id: string,
  name: string,
  importance = 0.5
): TreeBuilderGroupRow {
  return { id, name, description: "d", importance, concepts: "[]", sourceUnitIds: "[]" };
}

describe("TreeBuilder", () => {
  let builder: TreeBuilder;
  let repo: ReturnType<typeof createFakeRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createFakeRepo();
    builder = new TreeBuilder({ repository: repo, llmProvider: fakeLlm });
    mockBuildBuildTreePrompt.mockReturnValue({ system: "SYS", user: "USR" });
    repo.findTopicGroupsByCourse.mockResolvedValue([]);
    repo.deleteNodesByCourse.mockResolvedValue(undefined);
    repo.findLatestVersion.mockResolvedValue(null); // No previous version → use 1

    // Each createNode() returns a row with a sequential generated id so
    // parentRef resolution is predictable.
    let counter = 0;
    repo.createNode.mockImplementation(async (data) => {
      counter++;
      return {
        id: `node-${counter}`,
        parentId: data.parentId,
        depth: data.depth,
        orderIndex: data.orderIndex,
        version: data.version,
        name: data.name,
        summary: data.summary,
        isLeaf: data.isLeaf,
        courseId: data.courseId,
        sourceMaterialId: data.sourceMaterialId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("input loading", () => {
    it("loads all TopicGroups for the course", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "G1")]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "G1", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      await builder.build("c-1");
      expect(repo.findTopicGroupsByCourse).toHaveBeenCalledWith("c-1");
    });

    it("returns an empty array when there are no TopicGroups", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([]);
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
      repo.findTopicGroupsByCourse.mockResolvedValue(
        groups.map((g) => makeGroupRow(g.id, g.name, g.importance))
      );
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "G1", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      await builder.build("c-1");
      expect(mockBuildBuildTreePrompt).toHaveBeenCalled();
    });

    it("calls LLMClient.chatJSON with the prompt messages", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "G1")]);
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
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "G1")]);
      mockChatJSON.mockRejectedValue(new Error("LLM 503"));
      await expect(builder.build("c-1")).rejects.toThrow(/LLM 503/);
    });
  });

  describe("tree construction", () => {
    it("builds a valid tree from 3 TopicGroups (one root, two children)", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([
        makeGroupRow("g-1", "Root", 0.9),
        makeGroupRow("g-2", "Child1"),
        makeGroupRow("g-3", "Child2"),
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
      repo.findTopicGroupsByCourse.mockResolvedValue([
        makeGroupRow("g-1", "Root", 0.9),
        makeGroupRow("g-2", "Child"),
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
      repo.findTopicGroupsByCourse.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => makeGroupRow(`g-${i}`, `Node${i}`))
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
      repo.findTopicGroupsByCourse.mockResolvedValue([
        makeGroupRow("g-1", "Root", 0.9),
        makeGroupRow("g-2", "Leaf1"),
        makeGroupRow("g-3", "Leaf2"),
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
      repo.findTopicGroupsByCourse.mockResolvedValue([
        makeGroupRow("g-1", "A"),
        makeGroupRow("g-2", "B"),
      ]);
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
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "A")]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "A", summary: "d", parentRef: "g-1", depth: 0 }],
        roots: ["g-1"],
      });
      await expect(builder.build("c-1")).rejects.toThrow(/cycle|ciclo/i);
    });

    it("rejects an indirect cycle (A → B → C → A)", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([
        makeGroupRow("g-1", "A"),
        makeGroupRow("g-2", "B"),
        makeGroupRow("g-3", "C"),
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
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "Root", 0.9)]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      repo.findLatestVersion.mockResolvedValue(null);
      await builder.build("c-1");
      expect(repo.createNode).toHaveBeenCalled();
      const data = repo.createNode.mock.calls[0][0];
      expect(data.version).toBe(1);
    });

    it("increments the version on subsequent builds", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "Root", 0.9)]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      // Previous build returned version 3
      repo.findLatestVersion.mockResolvedValue(3);
      await builder.build("c-1");
      const data = repo.createNode.mock.calls[0][0];
      expect(data.version).toBe(4);
    });
  });

  describe("persistence", () => {
    it("persists each node to the database with self-referencing parentId", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([
        makeGroupRow("g-1", "Root", 0.9),
        makeGroupRow("g-2", "Child"),
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
      expect(repo.createNode).toHaveBeenCalledTimes(2);
      // First call: root (parentId null)
      const firstData = repo.createNode.mock.calls[0][0];
      expect(firstData.parentId).toBeNull();
      expect(firstData.courseId).toBe("c-1");
      // Second call: child (parentId = root's id = "node-1")
      const secondData = repo.createNode.mock.calls[1][0];
      expect(secondData.parentId).not.toBeNull();
      expect(secondData.parentId).toBe("node-1");
    });

    it("returns TopicNode objects with database-assigned ids", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "Root", 0.9)]);
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
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "Root", 0.9)]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "Root", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      await builder.build("c-1");
      expect(repo.deleteNodesByCourse).toHaveBeenCalledWith("c-1");
    });
  });

  // ----- PR3: structure strategy -----

  describe("structure strategy", () => {
    /** A group row that carries source unit ids (provenance for sectionPath). */
    function groupWithUnits(
      id: string,
      name: string,
      unitIds: string[]
    ): TreeBuilderGroupRow {
      return {
        id,
        name,
        description: "d",
        importance: 0.5,
        concepts: "[]",
        sourceUnitIds: JSON.stringify(unitIds),
      };
    }

    let structureBuilder: TreeBuilder;

    beforeEach(() => {
      structureBuilder = new TreeBuilder({
        repository: repo,
        llmProvider: fakeLlm,
        strategy: "structure",
      });
      // replaceCourseNodes echoes the batch back as created rows with
      // deterministic ids (tempRef → "db:<tempRef>") so we can assert wiring.
      repo.replaceCourseNodes.mockImplementation(async (courseId, nodes) => {
        const idByRef = new Map(nodes.map((n) => [n.tempRef, `db:${n.tempRef}`]));
        return nodes.map((n) => ({
          id: idByRef.get(n.tempRef)!,
          courseId,
          parentId: n.parentTempRef ? idByRef.get(n.parentTempRef)! : null,
          name: n.name,
          summary: n.summary,
          depth: n.depth,
          orderIndex: n.orderIndex,
          isLeaf: n.isLeaf,
          version: n.version,
          sourceMaterialId: n.sourceMaterialId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      });
    });

    it("falls back to the LLM path when groups have no source units", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([makeGroupRow("g-1", "G1")]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "G1", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      await structureBuilder.build("c-1");
      // LLM path used → replaceCourseNodes NOT called, chatJSON called.
      expect(repo.replaceCourseNodes).not.toHaveBeenCalled();
      expect(mockChatJSON).toHaveBeenCalled();
    });

    it("falls back to LLM when units exist but none has a section path", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([
        groupWithUnits("g-1", "G1", ["u-1"]),
      ]);
      repo.findSectionPathsByUnitIds.mockResolvedValue([
        { unitId: "u-1", sectionPath: "[]" },
      ]);
      mockChatJSON.mockResolvedValue({
        nodes: [{ ref: "g-1", name: "G1", summary: "d", parentRef: null, depth: 0 }],
        roots: ["g-1"],
      });
      await structureBuilder.build("c-1");
      expect(repo.replaceCourseNodes).not.toHaveBeenCalled();
      expect(mockChatJSON).toHaveBeenCalled();
    });

    it("builds the skeleton from headings and hangs groups under their section (no LLM)", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([
        groupWithUnits("g-1", "Calor específico", ["u-1"]),
        groupWithUnits("g-2", "Entropía", ["u-2"]),
      ]);
      repo.findSectionPathsByUnitIds.mockResolvedValue([
        { unitId: "u-1", sectionPath: JSON.stringify(["3. Termodinámica", "3.1 Calor"]) },
        { unitId: "u-2", sectionPath: JSON.stringify(["3. Termodinámica", "3.2 Entropía"]) },
      ]);

      const result = await structureBuilder.build("c-1");

      // No LLM call in the structure path.
      expect(mockChatJSON).not.toHaveBeenCalled();
      expect(repo.replaceCourseNodes).toHaveBeenCalledTimes(1);

      // Skeleton: "3. Termodinámica" (root) → "3.1 Calor", "3.2 Entropía".
      const root = result.find((n) => n.name === "3. Termodinámica");
      expect(root).toBeDefined();
      expect(root!.parentId).toBeNull();
      expect(root!.depth).toBe(0);

      const calor = result.find((n) => n.name === "3.1 Calor");
      expect(calor!.parentId).toBe(root!.id);
      expect(calor!.depth).toBe(1);

      // Group "Calor específico" hangs under its section "3.1 Calor".
      const grp = result.find((n) => n.name === "Calor específico");
      expect(grp!.parentId).toBe(calor!.id);
      expect(grp!.depth).toBe(2);
      expect(grp!.isLeaf).toBe(true);
    });

    it("never exceeds MAX_DEPTH when hanging a group under a deep section", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([
        groupWithUnits("g-1", "Hoja", ["u-1"]),
      ]);
      // A 4-level heading chain: depth 0,1,2,3 (already at MAX_DEPTH=3).
      repo.findSectionPathsByUnitIds.mockResolvedValue([
        {
          unitId: "u-1",
          sectionPath: JSON.stringify(["A", "A.1", "A.1.1", "A.1.1.1"]),
        },
      ]);

      const result = await structureBuilder.build("c-1");
      for (const n of result) {
        expect(n.depth).toBeLessThanOrEqual(3);
      }
    });

    it("persists atomically via replaceCourseNodes (build-before-delete)", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([
        groupWithUnits("g-1", "X", ["u-1"]),
      ]);
      repo.findSectionPathsByUnitIds.mockResolvedValue([
        { unitId: "u-1", sectionPath: JSON.stringify(["1. Intro"]) },
      ]);
      await structureBuilder.build("c-1");
      // The atomic replace is used — NOT the per-node createNode + delete.
      expect(repo.replaceCourseNodes).toHaveBeenCalledTimes(1);
      expect(repo.deleteNodesByCourse).not.toHaveBeenCalled();
      expect(repo.createNode).not.toHaveBeenCalled();
    });

    it("increments version in the structure path", async () => {
      repo.findTopicGroupsByCourse.mockResolvedValue([
        groupWithUnits("g-1", "X", ["u-1"]),
      ]);
      repo.findSectionPathsByUnitIds.mockResolvedValue([
        { unitId: "u-1", sectionPath: JSON.stringify(["1. Intro"]) },
      ]);
      repo.findLatestVersion.mockResolvedValue(2);
      const result = await structureBuilder.build("c-1");
      for (const n of result) expect(n.version).toBe(3);
    });
  });
});

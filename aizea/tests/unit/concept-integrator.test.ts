import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockChatJSON,
  mockBuildIntegrateConceptsPrompt,
  mockEmbedBatch,
  mockSemanticUnitFindMany,
  mockUnitRepresentationFindMany,
  mockTopicGroupCreate,
  mockTopicGroupDeleteMany,
  mockTopicGroupFindMany,
} = vi.hoisted(() => ({
  mockChatJSON: vi.fn(),
  mockBuildIntegrateConceptsPrompt: vi.fn(),
  mockEmbedBatch: vi.fn(),
  mockSemanticUnitFindMany: vi.fn(),
  mockUnitRepresentationFindMany: vi.fn(),
  mockTopicGroupCreate: vi.fn(),
  mockTopicGroupDeleteMany: vi.fn(),
  mockTopicGroupFindMany: vi.fn(),
}));

vi.mock("@/lib/domain/llm/LLMClient", () => ({
  chatJSON: mockChatJSON,
  chat: vi.fn(),
}));

vi.mock("@/lib/domain/prompts/PromptManager", () => ({
  PromptManager: class MockPromptManager {
    buildIntegrateConceptsPrompt = mockBuildIntegrateConceptsPrompt;
  },
}));

vi.mock("@/lib/domain/rag/EmbeddingService", () => ({
  EmbeddingService: class MockEmbeddingService {
    embedBatch = mockEmbedBatch;
    embed = vi.fn();
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    semanticUnit: {
      findMany: mockSemanticUnitFindMany,
    },
    unitRepresentation: {
      findMany: mockUnitRepresentationFindMany,
    },
    topicGroup: {
      create: mockTopicGroupCreate,
      deleteMany: mockTopicGroupDeleteMany,
      findMany: mockTopicGroupFindMany,
    },
  },
}));

import { ConceptIntegrator } from "@/lib/domain/pipeline/ConceptIntegrator";
import type { Concept, UnitRepresentation } from "@/lib/types/pipeline";

// Mock TopicGroup model is added at runtime by the Prisma client. To allow
// tests to run we expose minimal `db.topicGroup` methods; Prisma model not
// present in schema.prisma — the implementation must persist groups using
// a JSON store or computed return. We mock the persistence layer instead.
// (See TopicGroup persistence comment in the implementation.)

// ----- helpers -----

function makeUnit(
  id: string,
  materialId: string,
  courseId: string
): { id: string; materialId: string; material: { courseId: string } } {
  return { id, materialId, material: { courseId } };
}

function makeRepresentation(
  unitId: string,
  concepts: Array<{ name: string; importance?: number }>
): UnitRepresentation & { _unit: { id: string; materialId: string; material: { courseId: string } } } {
  return {
    _unit: { id: unitId, materialId: "m-1", material: { courseId: "c-1" } },
    id: `rep-${unitId}`,
    unitId,
    concepts: concepts.map((c) => ({
      name: c.name,
      importance: c.importance ?? 0.5,
    })),
    mainIdeas: [],
    formulas: [],
    figures: [],
    prerequisites: [],
    introduces: [],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("ConceptIntegrator", () => {
  let integrator: ConceptIntegrator;

  beforeEach(() => {
    vi.clearAllMocks();
    integrator = new ConceptIntegrator();
    mockBuildIntegrateConceptsPrompt.mockReturnValue({
      system: "SYS",
      user: "USR",
    });
    // Default successful mocks
    mockSemanticUnitFindMany.mockResolvedValue([]);
    mockUnitRepresentationFindMany.mockResolvedValue([]);
    mockEmbedBatch.mockImplementation(async (texts: string[]) =>
      texts.map((t) => Array.from({ length: 8 }, (_, i) => (t.charCodeAt(0) + i) / 1000))
    );
    mockTopicGroupCreate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: `g-${Math.random()}`, ...data })
    );
    mockTopicGroupDeleteMany.mockResolvedValue({ count: 0 });
    mockTopicGroupFindMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loading inputs", () => {
    it("loads all UnitRepresentations for the course (via SemanticUnit→Material→Course)", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
        makeUnit("u-2", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
        makeRepresentation("u-2", [{ name: "energy" }]),
      ]);
      mockChatJSON.mockResolvedValue({
        groups: [
          {
            id: "thermo",
            name: "Thermodynamics",
            description: "Heat & energy",
            importance: 0.9,
            concepts: ["entropy", "energy"],
            sourceUnitIds: ["u-1", "u-2"],
          },
        ],
      });
      await integrator.integrate("c-1");
      expect(mockSemanticUnitFindMany).toHaveBeenCalled();
      expect(mockUnitRepresentationFindMany).toHaveBeenCalled();
    });

    it("returns an empty array when there are no representations", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([]);
      mockUnitRepresentationFindMany.mockResolvedValue([]);
      const result = await integrator.integrate("c-1");
      expect(result).toEqual([]);
      // No LLM call needed
      expect(mockChatJSON).not.toHaveBeenCalled();
    });
  });

  describe("embedding-based pre-clustering", () => {
    it("embeds every distinct concept name before clustering", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
        makeUnit("u-2", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }, { name: "temperature" }]),
        makeRepresentation("u-2", [{ name: "energy" }]),
      ]);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g1", name: "G1", description: "d", importance: 0.5, concepts: ["entropy"], sourceUnitIds: ["u-1"] },
        ],
      });
      await integrator.integrate("c-1");
      expect(mockEmbedBatch).toHaveBeenCalledTimes(1);
      const callArgs = mockEmbedBatch.mock.calls[0][0] as string[];
      expect(callArgs.sort()).toEqual(["energy", "entropy", "temperature"]);
    });

    it("does not embed duplicate concept names", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
        makeUnit("u-2", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
        makeRepresentation("u-2", [{ name: "entropy" }]),
      ]);
      mockChatJSON.mockResolvedValue({ groups: [] });
      await integrator.integrate("c-1");
      const callArgs = mockEmbedBatch.mock.calls[0][0] as string[];
      expect(callArgs).toEqual(["entropy"]);
    });
  });

  describe("LLM integration", () => {
    it("calls PromptManager.buildIntegrateConceptsPrompt with pre-clustered groups", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }, { name: "energy" }]),
      ]);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g1", name: "Thermo", description: "d", importance: 0.5, concepts: ["entropy", "energy"], sourceUnitIds: ["u-1"] },
        ],
      });
      await integrator.integrate("c-1");
      expect(mockBuildIntegrateConceptsPrompt).toHaveBeenCalled();
      const passedArg = mockBuildIntegrateConceptsPrompt.mock.calls[0][0];
      // Argument should be an array of clusters (groups of concept names)
      expect(Array.isArray(passedArg)).toBe(true);
    });

    it("calls LLMClient.chatJSON with the prompt system/user messages", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
      ]);
      mockBuildIntegrateConceptsPrompt.mockReturnValue({
        system: "SYS-MARKER",
        user: "USR-MARKER",
      });
      mockChatJSON.mockResolvedValue({ groups: [] });
      await integrator.integrate("c-1");
      expect(mockChatJSON).toHaveBeenCalledWith([
        { role: "system", content: "SYS-MARKER" },
        { role: "user", content: "USR-MARKER" },
      ]);
    });

    it("propagates errors from the LLM", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
      ]);
      mockChatJSON.mockRejectedValue(new Error("LLM 503"));
      await expect(integrator.integrate("c-1")).rejects.toThrow(/LLM 503/);
    });
  });

  describe("TopicGroup construction", () => {
    it("returns one TopicGroup per LLM-provided group", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
        makeUnit("u-2", "m-1", "c-1"),
        makeUnit("u-3", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
        makeRepresentation("u-2", [{ name: "energy" }]),
        makeRepresentation("u-3", [{ name: "force" }]),
      ]);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g1", name: "Thermodynamics", description: "Heat", importance: 0.9, concepts: ["entropy", "energy"], sourceUnitIds: ["u-1", "u-2"] },
          { id: "g2", name: "Mechanics", description: "Forces", importance: 0.8, concepts: ["force", "energy"], sourceUnitIds: ["u-2", "u-3"] },
        ],
      });
      const result = await integrator.integrate("c-1");
      expect(result).toHaveLength(2);
      for (const g of result) {
        expect(g.name).toBeTruthy();
        expect(g.description).toBeTruthy();
        expect(typeof g.importance).toBe("number");
        expect(g.concepts).toEqual(expect.any(Array));
        expect(g.sourceUnitIds).toEqual(expect.any(Array));
        expect(g.id).toBeTruthy();
      }
    });

    it("discards groups with empty names", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
      ]);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g1", name: "", description: "Empty name", importance: 0.5, concepts: ["entropy"], sourceUnitIds: ["u-1"] },
          { id: "g2", name: "   ", description: "Whitespace name", importance: 0.5, concepts: ["entropy"], sourceUnitIds: ["u-1"] },
          { id: "g3", name: "Valid", description: "ok", importance: 0.5, concepts: ["entropy"], sourceUnitIds: ["u-1"] },
        ],
      });
      const result = await integrator.integrate("c-1");
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Valid");
    });

    it("clamps importance to [0, 1] range", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
      ]);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g1", name: "g1", description: "d", importance: 5, concepts: ["entropy"], sourceUnitIds: ["u-1"] },
          { id: "g2", name: "g2", description: "d", importance: -2, concepts: ["entropy"], sourceUnitIds: ["u-1"] },
        ],
      });
      const result = await integrator.integrate("c-1");
      for (const g of result) {
        expect(g.importance).toBeGreaterThanOrEqual(0);
        expect(g.importance).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("TopicGroup persistence", () => {
    it("persists each TopicGroup to the database", async () => {
      mockSemanticUnitFindMany.mockResolvedValue([
        makeUnit("u-1", "m-1", "c-1"),
      ]);
      mockUnitRepresentationFindMany.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
      ]);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g1", name: "Thermo", description: "d", importance: 0.5, concepts: ["entropy"], sourceUnitIds: ["u-1"] },
        ],
      });
      // Track calls
      const created: unknown[] = [];
      mockTopicGroupCreate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `g-${created.length}`, ...data };
      });
      await integrator.integrate("c-1");
      expect(mockTopicGroupCreate).toHaveBeenCalled();
      expect(created.length).toBeGreaterThan(0);
      const first = created[0] as Record<string, unknown>;
      expect(first.courseId).toBe("c-1");
      expect(typeof first.name).toBe("string");
    });
  });
});

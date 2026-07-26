import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockChatJSON,
  mockBuildIntegrateConceptsPrompt,
  mockEmbedBatch,
} = vi.hoisted(() => ({
  mockChatJSON: vi.fn(),
  mockBuildIntegrateConceptsPrompt: vi.fn(),
  mockEmbedBatch: vi.fn(),
}));

vi.mock("@/lib/domain/prompts/PromptManager", () => ({
  PromptManager: class MockPromptManager {
    buildIntegrateConceptsPrompt = mockBuildIntegrateConceptsPrompt;
  },
}));

import { ConceptIntegrator } from "@/lib/domain/pipeline/ConceptIntegrator";
import type {
  ConceptRepresentationRow,
  CreateTopicGroupInput,
  CreatedTopicGroupRow,
  IConceptIntegratorRepository,
} from "@/lib/application/ports/concept-integrator-repository.port";
import type { ILLMProvider } from "@/lib/application/ports/llm-provider.port";
import type { IEmbeddingProvider } from "@/lib/application/ports/embedding-provider.port";

// ----- fake providers -----
//
// La inversión DI (Fase 1) hace que ConceptIntegrator dependa de `ILLMProvider`
// e `IEmbeddingProvider` inyectados en vez de la función libre `chatJSON` y
// `new EmbeddingService()`. El test inyecta estos fakes.
const fakeLlm: ILLMProvider = {
  chatJSON: mockChatJSON,
  chat: vi.fn(),
  name: "fake-llm",
};

const fakeEmbedding: IEmbeddingProvider = {
  embedBatch: mockEmbedBatch,
  embed: vi.fn(),
  dimensions: 8,
  dummyVector: (seed = "") =>
    Array.from({ length: 8 }, (_, i) => (seed.charCodeAt(0) + i) / 1000),
};

// ----- fake repository -----
//
// La purificación del dominio (Fase 1) hace que ConceptIntegrator dependa de
// `IConceptIntegratorRepository` en vez de Prisma. El test inyecta este fake
// en lugar de mockear `@/lib/db`.
function createFakeRepo() {
  return {
    findUnitIdsByCourse: vi.fn<(courseId: string) => Promise<string[]>>(),
    findRepresentationsByUnitIds:
      vi.fn<(unitIds: string[]) => Promise<ConceptRepresentationRow[]>>(),
    createTopicGroup:
      vi.fn<(data: CreateTopicGroupInput) => Promise<CreatedTopicGroupRow>>(),
  } satisfies IConceptIntegratorRepository;
}

// ----- helpers -----

/** Build a representation row as the port returns it: unitId + JSON concepts. */
function makeRepresentation(
  unitId: string,
  concepts: Array<{ name: string; importance?: number }>
): ConceptRepresentationRow {
  return {
    unitId,
    concepts: JSON.stringify(
      concepts.map((c) => ({ name: c.name, importance: c.importance ?? 0.5 }))
    ),
  };
}

describe("ConceptIntegrator", () => {
  let integrator: ConceptIntegrator;
  let repo: ReturnType<typeof createFakeRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createFakeRepo();
    integrator = new ConceptIntegrator({
      repository: repo,
      embeddingProvider: fakeEmbedding,
      llmProvider: fakeLlm,
    });
    mockBuildIntegrateConceptsPrompt.mockReturnValue({
      system: "SYS",
      user: "USR",
    });
    // Default successful mocks
    repo.findUnitIdsByCourse.mockResolvedValue([]);
    repo.findRepresentationsByUnitIds.mockResolvedValue([]);
    mockEmbedBatch.mockImplementation(async (texts: string[]) =>
      texts.map((t) => Array.from({ length: 8 }, (_, i) => (t.charCodeAt(0) + i) / 1000))
    );
    repo.createTopicGroup.mockImplementation(async (data) => ({
      id: `g-${Math.random()}`,
      name: data.name,
      description: data.description,
      importance: data.importance,
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("loading inputs", () => {
    it("loads all UnitRepresentations for the course (via SemanticUnit→Material→Course)", async () => {
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1", "u-2"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
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
      expect(repo.findUnitIdsByCourse).toHaveBeenCalled();
      expect(repo.findRepresentationsByUnitIds).toHaveBeenCalled();
    });

    it("returns an empty array when there are no representations", async () => {
      repo.findUnitIdsByCourse.mockResolvedValue([]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([]);
      const result = await integrator.integrate("c-1");
      expect(result).toEqual([]);
      // No LLM call needed
      expect(mockChatJSON).not.toHaveBeenCalled();
    });
  });

  describe("embedding-based pre-clustering", () => {
    it("embeds every distinct concept name before clustering", async () => {
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1", "u-2"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
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
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1", "u-2"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
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
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
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
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
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
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
      ]);
      mockChatJSON.mockRejectedValue(new Error("LLM 503"));
      await expect(integrator.integrate("c-1")).rejects.toThrow(/LLM 503/);
    });
  });

  describe("TopicGroup construction", () => {
    it("returns one TopicGroup per LLM-provided group", async () => {
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1", "u-2", "u-3"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
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
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
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
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
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
      repo.findUnitIdsByCourse.mockResolvedValue(["u-1"]);
      repo.findRepresentationsByUnitIds.mockResolvedValue([
        makeRepresentation("u-1", [{ name: "entropy" }]),
      ]);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g1", name: "Thermo", description: "d", importance: 0.5, concepts: ["entropy"], sourceUnitIds: ["u-1"] },
        ],
      });
      // Track calls
      const created: CreateTopicGroupInput[] = [];
      repo.createTopicGroup.mockImplementation(async (data) => {
        created.push(data);
        return {
          id: `g-${created.length}`,
          name: data.name,
          description: data.description,
          importance: data.importance,
        };
      });
      await integrator.integrate("c-1");
      expect(repo.createTopicGroup).toHaveBeenCalled();
      expect(created.length).toBeGreaterThan(0);
      const first = created[0];
      expect(first.courseId).toBe("c-1");
      expect(typeof first.name).toBe("string");
    });
  });
});

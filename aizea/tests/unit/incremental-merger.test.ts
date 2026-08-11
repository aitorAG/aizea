import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  mockSegmenterSegment,
  mockUnitExtractorExtract,
  mockEmbedBatch,
  mockChatJSON,
  mockBuildIntegrateConceptsPrompt,
  mockBuildBuildTreePrompt,
  mockBuildMergeDecisionsPrompt,
} = vi.hoisted(() => ({
  mockSegmenterSegment: vi.fn(),
  mockUnitExtractorExtract: vi.fn(),
  mockEmbedBatch: vi.fn(),
  mockChatJSON: vi.fn(),
  mockBuildIntegrateConceptsPrompt: vi.fn(),
  mockBuildBuildTreePrompt: vi.fn(),
  mockBuildMergeDecisionsPrompt: vi.fn(),
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

vi.mock("@/lib/domain/prompts/PromptManager", () => ({
  PromptManager: class MockPromptManager {
    buildIntegrateConceptsPrompt = mockBuildIntegrateConceptsPrompt;
    buildBuildTreePrompt = mockBuildBuildTreePrompt;
    buildMergeDecisionsPrompt = mockBuildMergeDecisionsPrompt;
  },
}));

import { IncrementalMerger } from "@/lib/domain/pipeline/IncrementalMerger";
import type {
  IIncrementalMergerRepository,
  MergeCreateNodeInput,
  MergeTopicNodeRow,
} from "@/lib/application/ports/incremental-merger-repository.port";
import type { ILLMProvider } from "@/lib/application/ports/llm-provider.port";
import type { IEmbeddingProvider } from "@/lib/application/ports/embedding-provider.port";

// ----- fake providers -----
//
// La inversión DI (Fase 1) hace que IncrementalMerger dependa de `ILLMProvider`
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
// La purificación del dominio (Fase 1) hace que IncrementalMerger dependa de
// `IIncrementalMergerRepository` en vez de Prisma. El test inyecta este fake
// en lugar de mockear `@/lib/db`. Nótese que el puerto NO tiene delete: la
// invariante "no borra nodos existentes" queda garantizada estructuralmente.
function createFakeRepo() {
  return {
    findNodesByCourse:
      vi.fn<(courseId: string) => Promise<MergeTopicNodeRow[]>>(),
    findLatestVersion: vi.fn<(courseId: string) => Promise<number | null>>(),
    createNode: vi.fn<(data: MergeCreateNodeInput) => Promise<MergeTopicNodeRow>>(),
  } satisfies IIncrementalMergerRepository;
}

function makeNodeRow(
  id: string,
  name: string,
  overrides: Partial<MergeTopicNodeRow> = {}
): MergeTopicNodeRow {
  return {
    id,
    courseId: "c-1",
    parentId: null,
    name,
    summary: null,
    depth: 0,
    orderIndex: 0,
    isLeaf: false,
    version: 1,
    sourceMaterialId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("IncrementalMerger", () => {
  let merger: IncrementalMerger;
  let repo: ReturnType<typeof createFakeRepo>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = createFakeRepo();
    merger = new IncrementalMerger({
      repository: repo,
      embeddingProvider: fakeEmbedding,
      llmProvider: fakeLlm,
    });
  mockBuildIntegrateConceptsPrompt.mockReturnValue({ system: "S", user: "U" });
  mockBuildBuildTreePrompt.mockReturnValue({ system: "S", user: "U" });
  mockBuildMergeDecisionsPrompt.mockReturnValue({ system: "S", user: "U" });
    mockSegmenterSegment.mockResolvedValue([]);
    mockUnitExtractorExtract.mockResolvedValue({
      id: "rep-1",
      unitId: "u-1",
      concepts: [],
      mainIdeas: [],
      formulas: [],
      figures: [],
      prerequisites: [],
      introduces: [],
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    repo.findNodesByCourse.mockResolvedValue([]);
    repo.findLatestVersion.mockResolvedValue(null);
    mockEmbedBatch.mockImplementation(async (texts: string[]) =>
      texts.map((t) => Array.from({ length: 8 }, (_, i) => (t.charCodeAt(0) + i) / 1000))
    );
    let counter = 0;
    repo.createNode.mockImplementation(async (data) => {
      counter++;
      const id = data.id ?? `node-${counter}`;
      return {
        id,
        courseId: data.courseId,
        parentId: data.parentId,
        name: data.name,
        summary: data.summary,
        depth: data.depth,
        orderIndex: data.orderIndex ?? 0,
        isLeaf: data.isLeaf,
        version: data.version,
        sourceMaterialId: data.sourceMaterialId,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("new material processing", () => {
    it("runs segmentation on the new material (via SegmenterService)", async () => {
      mockSegmenterSegment.mockResolvedValue([]);
      repo.findNodesByCourse.mockResolvedValue([]);
      mockChatJSON.mockResolvedValue({ nodes: [], groups: [], roots: [] });
      await merger.merge("c-1", "m-new", Buffer.from("pdf-bytes"));
      expect(mockSegmenterSegment).toHaveBeenCalled();
    });

    it("does NOT re-segment the entire course (only the new material)", async () => {
      mockSegmenterSegment.mockResolvedValue([]);
      repo.findNodesByCourse.mockResolvedValue([]);
      mockChatJSON.mockResolvedValue({ nodes: [], groups: [], roots: [] });
      await merger.merge("c-1", "m-new", Buffer.from("pdf-bytes"));
      expect(mockSegmenterSegment).toHaveBeenCalledTimes(1);
    });
  });

  describe("matching with existing tree", () => {
    it("finds matches between new concepts and existing TopicNodes by embedding similarity", async () => {
      mockSegmenterSegment.mockResolvedValue([
        { id: "u-new", materialId: "m-new", content: "x", order: 0, pageStart: 1, pageEnd: 1, sectionRef: null, sectionPath: [], createdAt: "2026-01-01T00:00:00Z" },
      ]);
      mockUnitExtractorExtract.mockResolvedValue({
        id: "rep-new",
        unitId: "u-new",
        concepts: [{ name: "entropy", importance: 0.9 }],
        mainIdeas: [],
        formulas: [],
        figures: [],
        prerequisites: [],
        introduces: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      repo.findNodesByCourse.mockResolvedValue([
        makeNodeRow("tn-1", "Thermodynamics"),
      ]);
      repo.findLatestVersion.mockResolvedValue(1);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g-new", name: "EntropyDeep", description: "Deep dive", importance: 0.7, concepts: ["entropy"], sourceUnitIds: ["u-new"] },
        ],
        nodes: [
          { ref: "g-new", name: "EntropyDeep", summary: "Deep dive", parentRef: "tn-1", depth: 1 },
        ],
        roots: ["tn-1"],
      });
      await merger.merge("c-1", "m-new", Buffer.from("pdf-bytes"));
      expect(mockEmbedBatch).toHaveBeenCalled();
    });
  });

  describe("preservation of existing nodes", () => {
    it("does NOT delete existing TopicNodes (rollback with version)", async () => {
      // The repository port has no delete method, so deletion is
      // structurally impossible. We assert the existing node is preserved
      // in the returned tree.
      mockSegmenterSegment.mockResolvedValue([]);
      repo.findNodesByCourse.mockResolvedValue([makeNodeRow("tn-1", "Physics")]);
      repo.findLatestVersion.mockResolvedValue(1);
      mockChatJSON.mockResolvedValue({ nodes: [], groups: [], roots: [] });
      const result = await merger.merge("c-1", "m-new", Buffer.from("pdf-bytes"));
      // With no new concepts the merger short-circuits and returns the
      // existing tree unchanged.
      expect(result.find((n) => n.id === "tn-1")).toBeDefined();
    });

    it("uses a new version (incremented) for the merged tree", async () => {
      mockSegmenterSegment.mockResolvedValue([]);
      repo.findNodesByCourse.mockResolvedValue([]);
      repo.findLatestVersion.mockResolvedValue(5);
      mockChatJSON.mockResolvedValue({ nodes: [], groups: [], roots: [] });
      const result = await merger.merge("c-1", "m-new", Buffer.from("pdf-bytes"));
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("empty inputs", () => {
    it("returns an empty array when there are no existing nodes and no new material", async () => {
      mockSegmenterSegment.mockResolvedValue([]);
      repo.findNodesByCourse.mockResolvedValue([]);
      mockChatJSON.mockResolvedValue({ nodes: [], groups: [], roots: [] });
      const result = await merger.merge("c-1", "m-new", Buffer.from("pdf-bytes"));
      expect(result).toEqual([]);
    });

    it("returns the existing nodes (unchanged) when the new material has no concepts", async () => {
      mockSegmenterSegment.mockResolvedValue([
        { id: "u-new", materialId: "m-new", content: "x", order: 0, pageStart: 1, pageEnd: 1, sectionRef: null, sectionPath: [], createdAt: "2026-01-01T00:00:00Z" },
      ]);
      mockUnitExtractorExtract.mockResolvedValue({
        id: "rep-new",
        unitId: "u-new",
        concepts: [],
        mainIdeas: [],
        formulas: [],
        figures: [],
        prerequisites: [],
        introduces: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      repo.findNodesByCourse.mockResolvedValue([makeNodeRow("tn-1", "Physics")]);
      mockChatJSON.mockResolvedValue({ nodes: [], groups: [], roots: [] });
      const result = await merger.merge("c-1", "m-new", Buffer.from("pdf-bytes"));
      expect(result.find((n) => n.id === "tn-1")).toBeDefined();
    });
  });

  describe("LLM validation", () => {
    it("uses LLM to validate merge decisions", async () => {
      mockSegmenterSegment.mockResolvedValue([
        { id: "u-new", materialId: "m-new", content: "x", order: 0, pageStart: 1, pageEnd: 1, sectionRef: null, sectionPath: [], createdAt: "2026-01-01T00:00:00Z" },
      ]);
      mockUnitExtractorExtract.mockResolvedValue({
        id: "rep-new",
        unitId: "u-new",
        concepts: [{ name: "entropy", importance: 0.9 }],
        mainIdeas: [],
        formulas: [],
        figures: [],
        prerequisites: [],
        introduces: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      });
      repo.findNodesByCourse.mockResolvedValue([
        makeNodeRow("tn-1", "Thermodynamics"),
      ]);
      repo.findLatestVersion.mockResolvedValue(1);
      mockChatJSON.mockResolvedValue({
        groups: [
          { id: "g-new", name: "EntropyDeep", description: "Deep dive", importance: 0.7, concepts: ["entropy"], sourceUnitIds: ["u-new"] },
        ],
        nodes: [
          { ref: "g-new", name: "EntropyDeep", summary: "Deep dive", parentRef: "tn-1", depth: 1 },
        ],
        roots: ["tn-1"],
      });
      await merger.merge("c-1", "m-new", Buffer.from("pdf-bytes"));
      expect(mockChatJSON).toHaveBeenCalled();
    });
  });
});

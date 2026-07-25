import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

const {
  mockChatJSON,
  mockBuildExtractUnitPrompt,
  mockRenderLatexToPng,
  mockUnitRepresentationUpsert,
  mockUnitRepresentationFindUnique,
  mockFigureFindMany,
  mockMaterialFindUnique,
} = vi.hoisted(() => ({
  mockChatJSON: vi.fn(),
  mockBuildExtractUnitPrompt: vi.fn(),
  mockRenderLatexToPng: vi.fn(),
  mockUnitRepresentationUpsert: vi.fn(),
  mockUnitRepresentationFindUnique: vi.fn(),
  mockFigureFindMany: vi.fn(),
  mockMaterialFindUnique: vi.fn(),
}));

vi.mock("@/lib/domain/llm/LLMClient", () => ({
  chatJSON: mockChatJSON,
  chat: vi.fn(),
}));

vi.mock("@/lib/domain/prompts/PromptManager", () => ({
  PromptManager: class MockPromptManager {
    buildExtractUnitPrompt = mockBuildExtractUnitPrompt;
  },
}));

vi.mock("@/lib/domain/utils/latex-renderer", () => ({
  renderLatexToPng: mockRenderLatexToPng,
}));

vi.mock("@/lib/db", () => ({
  db: {
    unitRepresentation: {
      upsert: mockUnitRepresentationUpsert,
      findUnique: mockUnitRepresentationFindUnique,
    },
    figure: {
      findMany: mockFigureFindMany,
    },
    // UnitExtractor.loadFiguresForUnit resolves the unit's courseId via
    // material.findUnique so figures are scoped to the right course
    // (cross-course leak fix). The mock must provide it.
    material: {
      findUnique: mockMaterialFindUnique,
    },
  },
}));

import { UnitExtractor } from "@/lib/domain/pipeline/UnitExtractor";
import type { SemanticUnit } from "@/lib/types/pipeline";

const sampleUnit: SemanticUnit = {
  id: "u-1",
  materialId: "m-1",
  content: "Some text",
  order: 0,
  pageStart: 1,
  pageEnd: 2,
  sectionRef: "sec-1",
  createdAt: "2026-01-01T00:00:00Z",
};

describe("UnitExtractor", () => {
  let extractor: UnitExtractor;

  beforeEach(() => {
    extractor = new UnitExtractor();
    mockChatJSON.mockReset();
    mockBuildExtractUnitPrompt.mockReset();
    mockRenderLatexToPng.mockReset();
    mockUnitRepresentationUpsert.mockReset();
    mockUnitRepresentationFindUnique.mockReset();
    mockFigureFindMany.mockReset();

    mockBuildExtractUnitPrompt.mockReturnValue({
      system: "S",
      user: "U",
    });
    mockRenderLatexToPng.mockResolvedValue(Buffer.from("PNG-FAKE"));
    mockFigureFindMany.mockResolvedValue([]);
    // The extractor upserts (idempotent). The mock merges create+update
    // payloads the same way Prisma would, returning the persisted row.
    mockUnitRepresentationUpsert.mockImplementation(async ({ create }) => ({
      id: randomUUID(),
      ...create,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a UnitRepresentation with all required fields", async () => {
    mockChatJSON.mockResolvedValue({
      concepts: [{ name: "entropy", importance: 0.9, definition: "measure of disorder" }],
      mainIdeas: [{ text: "energy is conserved", salience: 0.8 }],
      formulas: [],
      figures: [],
      prerequisites: ["energy"],
      introduces: ["entropy"],
    });

    const result = await extractor.extract(sampleUnit);
    expect(result).toMatchObject({
      unitId: "u-1",
      concepts: expect.any(Array),
      mainIdeas: expect.any(Array),
      formulas: expect.any(Array),
      figures: expect.any(Array),
      prerequisites: expect.any(Array),
      introduces: expect.any(Array),
    });
  });

  it("calls PromptManager.buildExtractUnitPrompt with the unit", async () => {
    mockChatJSON.mockResolvedValue({
      concepts: [],
      mainIdeas: [],
      formulas: [],
      figures: [],
      prerequisites: [],
      introduces: [],
    });
    await extractor.extract(sampleUnit);
    expect(mockBuildExtractUnitPrompt).toHaveBeenCalledWith(sampleUnit);
  });

  it("calls LLMClient.chatJSON with the { system, user } pair", async () => {
    mockChatJSON.mockResolvedValue({
      concepts: [],
      mainIdeas: [],
      formulas: [],
      figures: [],
      prerequisites: [],
      introduces: [],
    });
    mockBuildExtractUnitPrompt.mockReturnValue({
      system: "SYS-MARKER",
      user: "USR-MARKER",
    });
    await extractor.extract(sampleUnit);
    expect(mockChatJSON).toHaveBeenCalledWith([
      { role: "system", content: "SYS-MARKER" },
      { role: "user", content: "USR-MARKER" },
    ]);
  });

  it("renders each LaTeX formula via the latex-renderer", async () => {
    mockChatJSON.mockResolvedValue({
      concepts: [],
      mainIdeas: [],
      formulas: [
        { latex: "E=mc^2", context: "energy equivalence" },
        { latex: "F=ma", context: "force" },
      ],
      figures: [],
      prerequisites: [],
      introduces: [],
    });

    await extractor.extract(sampleUnit);
    expect(mockRenderLatexToPng).toHaveBeenCalledWith("E=mc^2", expect.any(Object));
    expect(mockRenderLatexToPng).toHaveBeenCalledWith("F=ma", expect.any(Object));
  });

  it("populates Formula.imageBase64 from the rendered PNG buffer", async () => {
    mockRenderLatexToPng.mockResolvedValue(Buffer.from("FAKE-PNG-BYTES"));
    mockChatJSON.mockResolvedValue({
      concepts: [],
      mainIdeas: [],
      formulas: [{ latex: "E=mc^2" }],
      figures: [],
      prerequisites: [],
      introduces: [],
    });

    const result = await extractor.extract(sampleUnit);
    expect(result.formulas).toHaveLength(1);
    const expected = Buffer.from("FAKE-PNG-BYTES").toString("base64");
    expect(result.formulas[0].imageBase64).toBe(expected);
  });

  it("uses an empty string for imageBase64 when the renderer returns empty buffer", async () => {
    mockRenderLatexToPng.mockResolvedValue(Buffer.alloc(0));
    mockChatJSON.mockResolvedValue({
      concepts: [],
      mainIdeas: [],
      formulas: [{ latex: "\\invalid" }],
      figures: [],
      prerequisites: [],
      introduces: [],
    });

    const result = await extractor.extract(sampleUnit);
    expect(result.formulas[0].imageBase64).toBe("");
  });

  it("throws when the LLMClient throws (JobQueue handles retry)", async () => {
    mockChatJSON.mockRejectedValue(new Error("LLM 503"));
    await expect(extractor.extract(sampleUnit)).rejects.toThrow(/LLM 503/);
  });

  it("throws when the LLM returns invalid JSON (after chatJSON's parse step)", async () => {
    // The actual LLMClient.chatJSON will throw on non-JSON. We simulate that.
    mockChatJSON.mockRejectedValue(new Error("Unexpected token"));
    await expect(extractor.extract(sampleUnit)).rejects.toThrow();
  });

  it("persists the UnitRepresentation to the database", async () => {
    mockChatJSON.mockResolvedValue({
      concepts: [{ name: "x", importance: 0.5 }],
      mainIdeas: [],
      formulas: [],
      figures: [],
      prerequisites: [],
      introduces: [],
    });

    await extractor.extract(sampleUnit);
    expect(mockUnitRepresentationUpsert).toHaveBeenCalled();
    const call = mockUnitRepresentationUpsert.mock.calls[0][0];
    // Idempotent upsert: keyed by unitId, with create+update payloads.
    expect(call.where.unitId).toBe("u-1");
    expect(call.create.unitId).toBe("u-1");
    expect(typeof call.create.concepts).toBe("string"); // JSON-stringified
    expect(JSON.parse(call.create.concepts)).toEqual([
      { name: "x", importance: 0.5 },
    ]);
    // The update branch must carry the same JSON payload (minus unitId).
    expect(JSON.parse(call.update.concepts)).toEqual([
      { name: "x", importance: 0.5 },
    ]);
  });

  it("attaches figures from the database filtered by the unit's page range", async () => {
    const allFigures = [
      {
        id: "f-1",
        courseId: "c-1",
        filename: "fig1.png",
        caption: "First figure",
        pageNum: 1,
        tags: "[]",
        createdAt: new Date(),
      },
      {
        id: "f-2",
        courseId: "c-1",
        filename: "fig2.png",
        caption: "Out of range figure",
        pageNum: 99,
        tags: "[]",
        createdAt: new Date(),
      },
    ];
    // The extractor resolves the unit's courseId from the material
    // before querying figures (cross-course leak fix). Return the
    // course the sample figures belong to.
    mockMaterialFindUnique.mockResolvedValue({ courseId: "c-1" });
    // Simulate Prisma's courseId + pageNum filtering at the mock level.
    mockFigureFindMany.mockImplementation(async (args: { where?: { courseId?: string; pageNum?: { gte?: number; lte?: number } } }) => {
      const courseId = args?.where?.courseId;
      const range = args?.where?.pageNum;
      let out = allFigures;
      if (courseId != null) out = out.filter((f) => f.courseId === courseId);
      if (range) {
        out = out.filter((f) => {
          if (range.gte != null && (f.pageNum ?? 0) < range.gte) return false;
          if (range.lte != null && (f.pageNum ?? 0) > range.lte) return false;
          return true;
        });
      }
      return out;
    });
    mockChatJSON.mockResolvedValue({
      concepts: [],
      mainIdeas: [],
      formulas: [],
      figures: [],
      prerequisites: [],
      introduces: [],
    });

    const result = await extractor.extract(sampleUnit);
    // Should include only the figure on page 1 (within pageStart..pageEnd)
    const ids = result.figures.map((f) => f.id);
    expect(ids).toContain("f-1");
    expect(ids).not.toContain("f-2");
  });

  it("returns a UnitRepresentation with the database-assigned id", async () => {
    mockChatJSON.mockResolvedValue({
      concepts: [],
      mainIdeas: [],
      formulas: [],
      figures: [],
      prerequisites: [],
      introduces: [],
    });
    const result = await extractor.extract(sampleUnit);
    expect(result.id).toBeTruthy();
    expect(typeof result.id).toBe("string");
  });
});

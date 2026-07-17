import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";

const { mockParse, mockSemanticUnitCreate, mockFigureFindMany, mockExtractText } = vi.hoisted(() => ({
  mockParse: vi.fn(),
  mockSemanticUnitCreate: vi.fn(),
  mockFigureFindMany: vi.fn(),
  mockExtractText: vi.fn(),
}));

vi.mock("@/lib/domain/pdf/LayoutParser", () => ({
  LayoutParser: class MockLayoutParser {
    parse = mockParse;
  },
}));

vi.mock("@/lib/domain/pdf/PDFService", () => ({
  PDFService: class MockPDFService {
    extractText = mockExtractText;
    extractImages = vi.fn().mockResolvedValue([]);
    extractAll = vi.fn();
    extractFigures = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    semanticUnit: {
      create: mockSemanticUnitCreate,
    },
    figure: {
      findMany: mockFigureFindMany,
    },
  },
}));

import { SegmenterService } from "@/lib/domain/pipeline/SegmenterService";

const SAMPLE_STRUCTURE = {
  filename: "test.pdf",
  pageCount: 5,
  hasStructuralMarkup: true,
  sections: [
    {
      id: "sec-1",
      title: "1. Introduction",
      level: 0,
      numbering: "1",
      pageStart: 1,
      pageEnd: 2,
      content: "Intro content here",
      structural: true,
    },
    {
      id: "sec-2",
      title: "2. Methods",
      level: 0,
      numbering: "2",
      pageStart: 3,
      pageEnd: 4,
      content: "Methods content here",
      structural: true,
    },
    {
      id: "sec-3",
      title: "3. Results",
      level: 0,
      numbering: "3",
      pageStart: 5,
      pageEnd: 5,
      content: "Results content here",
      structural: true,
    },
  ],
  toc: [],
};

const SAMPLE_UNSTRUCTURED = {
  filename: "scan.pdf",
  pageCount: 3,
  hasStructuralMarkup: false,
  sections: [],
  toc: [],
};

describe("SegmenterService", () => {
  let service: SegmenterService;

  beforeEach(() => {
    service = new SegmenterService();
    mockParse.mockReset();
    mockSemanticUnitCreate.mockReset();
    mockFigureFindMany.mockReset();
    mockExtractText.mockReset();

    // Default mocks
    mockParse.mockResolvedValue(SAMPLE_STRUCTURE);
    mockSemanticUnitCreate.mockImplementation(async ({ data }) => ({
      id: randomUUID(),
      ...data,
      createdAt: new Date(),
    }));
    mockFigureFindMany.mockResolvedValue([]);
    // Default extractText: a fake plain text (used by fallback path)
    mockExtractText.mockResolvedValue({
      text: "Paragraph one with some meaningful content. ".repeat(5) +
        "\n\n" +
        "Paragraph two with more meaningful content. ".repeat(5) +
        "\n\n" +
        "Paragraph three with even more content. ".repeat(5),
      pages: 1,
      metadata: {},
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("structured PDFs", () => {
    it("returns one SemanticUnit per section when hasStructuralMarkup=true", async () => {
      const units = await service.segment(Buffer.from("x"), "mat-1");
      expect(units.length).toBeGreaterThanOrEqual(3);
    });

    it("each unit has non-empty content", async () => {
      const units = await service.segment(Buffer.from("x"), "mat-1");
      for (const u of units) {
        expect(u.content.length).toBeGreaterThan(0);
      }
    });

    it("assigns incrementing order field starting at 0", async () => {
      const units = await service.segment(Buffer.from("x"), "mat-1");
      for (let i = 0; i < units.length; i++) {
        expect(units[i].order).toBe(i);
      }
    });

    it("attaches sectionRef to units derived from a section", async () => {
      const units = await service.segment(Buffer.from("x"), "mat-1");
      expect(units[0].sectionRef).toBe("sec-1");
      expect(units[1].sectionRef).toBe("sec-2");
    });

    it("carries pageStart/pageEnd from the source section", async () => {
      const units = await service.segment(Buffer.from("x"), "mat-1");
      expect(units[0].pageStart).toBe(1);
      expect(units[0].pageEnd).toBe(2);
    });

    it("sets materialId on every unit", async () => {
      const units = await service.segment(Buffer.from("x"), "mat-99");
      for (const u of units) {
        expect(u.materialId).toBe("mat-99");
      }
    });
  });

  describe("unstructured PDFs (fallback)", () => {
    it("returns at least one unit when hasStructuralMarkup=false", async () => {
      mockParse.mockResolvedValue(SAMPLE_UNSTRUCTURED);
      const units = await service.segment(Buffer.from("x"), "mat-2");
      expect(units.length).toBeGreaterThanOrEqual(1);
    });

    it("fallback units have pageStart and pageEnd in the [1..pageCount] range", async () => {
      mockParse.mockResolvedValue(SAMPLE_UNSTRUCTURED);
      const units = await service.segment(Buffer.from("x"), "mat-2");
      for (const u of units) {
        if (u.pageStart != null) {
          expect(u.pageStart).toBeGreaterThanOrEqual(1);
        }
        if (u.pageEnd != null) {
          expect(u.pageEnd).toBeLessThanOrEqual(3);
        }
      }
    });

    it("fallback units have non-empty content", async () => {
      mockParse.mockResolvedValue(SAMPLE_UNSTRUCTURED);
      const units = await service.segment(Buffer.from("x"), "mat-2");
      for (const u of units) {
        expect(u.content.length).toBeGreaterThan(0);
      }
    });
  });

  describe("persistence", () => {
    it("persists each unit to the database via db.semanticUnit.create", async () => {
      await service.segment(Buffer.from("x"), "mat-3");
      expect(mockSemanticUnitCreate).toHaveBeenCalled();
      const calls = mockSemanticUnitCreate.mock.calls;
      for (const call of calls) {
        expect(call[0].data.materialId).toBe("mat-3");
        expect(call[0].data.content.length).toBeGreaterThan(0);
        expect(typeof call[0].data.order).toBe("number");
      }
    });

    it("returns units with database-assigned ids", async () => {
      const units = await service.segment(Buffer.from("x"), "mat-3");
      for (const u of units) {
        expect(u.id).toBeTruthy();
        expect(typeof u.id).toBe("string");
      }
    });
  });

  describe("size constraints", () => {
    it("does not create empty units", async () => {
      await service.segment(Buffer.from("x"), "mat-1");
      for (const call of mockSemanticUnitCreate.mock.calls) {
        expect(call[0].data.content).not.toBe("");
        expect(call[0].data.content.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("no structure AND no pages", () => {
    it("returns empty array when the structure has no sections and no pages", async () => {
      mockParse.mockResolvedValue({
        filename: "empty.pdf",
        pageCount: 0,
        hasStructuralMarkup: false,
        sections: [],
        toc: [],
      });
      // Override the default extractText mock to return empty text
      mockExtractText.mockResolvedValueOnce({ text: "", pages: 0, metadata: {} });
      const units = await service.segment(Buffer.from("x"), "mat-empty");
      expect(units).toEqual([]);
    });
  });
});

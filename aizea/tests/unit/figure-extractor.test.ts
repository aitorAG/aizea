import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FigureExtractor } from "@/lib/domain/figures/FigureExtractor";
import { PDFService } from "@/lib/domain/pdf/PDFService";
import { db } from "@/lib/db";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const mockExtractFigures = vi.hoisted(() =>
  vi.fn<(_buffer: Buffer) => Promise<Array<{ caption: string; pageNum: number | null }>>>(() =>
    Promise.resolve([
      { caption: "Figura 1: Diagrama de flujo", pageNum: 1 },
      { caption: "Figure 2.1: Detalle del sistema", pageNum: 2 },
    ])
  )
);

vi.mock("@/lib/domain/pdf/PDFService", () => ({
  PDFService: class MockPDFService {
    extractFigures = mockExtractFigures;
    extractImages = vi.fn().mockResolvedValue([]);
  },
}));

describe("FigureExtractor", () => {
  let extractor: FigureExtractor;
  let tempDir: string;
  let fakeBuffer: Buffer;
  const createdFigureIds: string[] = [];
  const createdCourseIds: string[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "figures-test-"));
    extractor = new FigureExtractor(new PDFService(), tempDir);
    fakeBuffer = Buffer.from("fake-pdf-content");
    mockExtractFigures.mockClear();
  });

  afterEach(async () => {
    for (const id of createdFigureIds.splice(0)) {
      await db.figure.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdCourseIds.splice(0)) {
      await db.course.delete({ where: { id } }).catch(() => {});
    }
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  async function makeFixture() {
    const course = await db.course.create({
      data: { name: `test-figure-course-${Date.now()}` },
    });
    createdCourseIds.push(course.id);
    return { course };
  }

  describe("extractAndSave", () => {
    it("extracts figures from PDF and saves them to the database", async () => {
      const { course } = await makeFixture();

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      expect(mockExtractFigures).toHaveBeenCalledWith(fakeBuffer);
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({
        caption: "Figura 1: Diagrama de flujo",
        pageNum: 1,
      });
      expect(results[1]).toMatchObject({
        caption: "Figure 2.1: Detalle del sistema",
        pageNum: 2,
      });

      for (const result of results) {
        createdFigureIds.push(result.id);
        const dbFigure = await db.figure.findUnique({ where: { id: result.id } });
        expect(dbFigure).not.toBeNull();
        expect(dbFigure?.courseId).toBe(course.id);
        expect(dbFigure?.filename).toBe(result.filename);
        expect(dbFigure?.caption).toBe(result.caption);
        expect(dbFigure?.pageNum).toBe(result.pageNum);
      }
    });

    it("saves placeholder files in the figures directory", async () => {
      const { course } = await makeFixture();

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      for (const result of results) {
        createdFigureIds.push(result.id);
        const filePath = path.join(tempDir, result.filename);
        const content = await fs.readFile(filePath);
        // Tiny 1x1 transparent PNG written as fallback when no real image matches
        expect(content.subarray(0, 8)).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        );
      }
    });

    it("returns empty array when no figures are found", async () => {
      const { course } = await makeFixture();
      mockExtractFigures.mockResolvedValueOnce([]);

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      expect(results).toEqual([]);
    });

    it("deduplicates figures based on caption", async () => {
      const { course } = await makeFixture();
      mockExtractFigures.mockResolvedValueOnce([
        { caption: "Figura 1: Test", pageNum: 1 },
        { caption: "Figura 1: Test", pageNum: 1 },
      ]);

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      expect(results).toHaveLength(2);
      createdFigureIds.push(...results.map((r) => r.id));
    });

    it("handles figures without page numbers", async () => {
      const { course } = await makeFixture();
      mockExtractFigures.mockResolvedValueOnce([
        { caption: "Figura 3: Sin pagina", pageNum: null },
      ]);

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      expect(results).toHaveLength(1);
      expect(results[0].pageNum).toBeNull();
      createdFigureIds.push(results[0].id);
    });
  });
});

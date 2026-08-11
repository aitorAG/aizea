import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FigureExtractor } from "@/lib/domain/figures/FigureExtractor";
import { FsFigureStore } from "@/lib/infrastructure/figures/figure-store";
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

// A real (non-placeholder) PNG byte header so we can assert the stored file is
// the extracted image, not a 1×1 placeholder.
const REAL_PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("real-image-page-content-bytes"),
]);

const mockExtractImages = vi.hoisted(() =>
  vi.fn(() =>
    Promise.resolve([
      { id: "img-1", pageNum: 1, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]), width: 10, height: 10, format: "png" },
      { id: "img-2", pageNum: 2, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 4, 5, 6]), width: 10, height: 10, format: "png" },
    ])
  )
);

vi.mock("@/lib/domain/pdf/PDFService", () => ({
  PDFService: class MockPDFService {
    extractFigures = mockExtractFigures;
    extractImages = mockExtractImages;
  },
}));

// compressToWebP passthrough so the stored bytes keep the PNG magic header
// (otherwise sharp would re-encode and the magic-byte assertion would change).
vi.mock("@/lib/domain/utils/image-compressor", () => ({
  compressToWebP: (b: Buffer) => Promise.resolve(b),
}));

describe("FigureExtractor", () => {
  let extractor: FigureExtractor;
  let tempDir: string;
  let fakeBuffer: Buffer;
  const createdFigureIds: string[] = [];
  const createdCourseIds: string[] = [];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "figures-test-"));
    extractor = new FigureExtractor(new PDFService(), new FsFigureStore(tempDir));
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

    it("saves the REAL extracted image bytes in the figures directory", async () => {
      const { course } = await makeFixture();

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      for (const result of results) {
        createdFigureIds.push(result.id);
        const filePath = path.join(tempDir, result.filename);
        const content = await fs.readFile(filePath);
        // v1.0: real image bytes are stored (PNG magic header), NOT a 1×1
        // placeholder. Real images carry extra payload bytes beyond the header.
        expect(content.subarray(0, 8)).toEqual(
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        );
        expect(content.length).toBeGreaterThan(8); // not a bare 1×1 stub
      }
    });

    it("skips figures with no matching real image (no placeholder) when no rasterizer", async () => {
      const { course } = await makeFixture();
      // A caption on page 3, but images only exist on pages 1 & 2 → skipped.
      mockExtractFigures.mockResolvedValueOnce([
        { caption: "Figura 9: sin imagen", pageNum: 3 },
      ]);

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      expect(results).toEqual([]);
    });

    it("v1.0 (Opción B): rasterises figures with a caption but NO embedded image", async () => {
      const { course } = await makeFixture();
      // Caption on page 3 with no embedded raster; a rasterizer produces a crop.
      mockExtractFigures.mockResolvedValueOnce([
        { caption: "Figura 9: diagrama vectorial", pageNum: 3 },
      ]);
      const rasterPng = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from("rasterised-vector-figure-crop"),
      ]);
      const rasterizer = {
        rasterizeFigure: vi.fn(async () => ({ png: rasterPng, width: 300, height: 200 })),
      };
      const extractorWithRaster = new FigureExtractor(
        new PDFService(),
        new FsFigureStore(tempDir),
        rasterizer
      );

      const results = await extractorWithRaster.extractAndSave(fakeBuffer, course.id);

      expect(results).toHaveLength(1);
      expect(rasterizer.rasterizeFigure).toHaveBeenCalledWith(fakeBuffer, 3);
      createdFigureIds.push(results[0].id);
      // The stored file is the rasterised crop (PNG magic header).
      const content = await fs.readFile(path.join(tempDir, results[0].filename));
      expect(content.subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      );
      expect(content.length).toBeGreaterThan(8);
    });

    it("v1.0 (Opción B): still skips when the rasterizer returns null", async () => {
      const { course } = await makeFixture();
      mockExtractFigures.mockResolvedValueOnce([
        { caption: "Figura 9: sin geometria", pageNum: 3 },
      ]);
      const rasterizer = { rasterizeFigure: vi.fn(async () => null) };
      const extractorWithRaster = new FigureExtractor(
        new PDFService(),
        new FsFigureStore(tempDir),
        rasterizer
      );

      const results = await extractorWithRaster.extractAndSave(fakeBuffer, course.id);

      expect(results).toEqual([]);
      expect(rasterizer.rasterizeFigure).toHaveBeenCalledWith(fakeBuffer, 3);
    });

    it("returns empty array when no figures are found", async () => {
      const { course } = await makeFixture();
      mockExtractFigures.mockResolvedValueOnce([]);

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      expect(results).toEqual([]);
    });

    it("matches distinct captions on a page to the images on that page", async () => {
      const { course } = await makeFixture();
      // Two distinct captions on page 1; provide two images on page 1.
      mockExtractFigures.mockResolvedValueOnce([
        { caption: "Figura 1: A", pageNum: 1 },
        { caption: "Figura 2: B", pageNum: 1 },
      ]);
      mockExtractImages.mockResolvedValueOnce([
        { id: "i1", pageNum: 1, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), width: 5, height: 5, format: "png" },
        { id: "i2", pageNum: 1, data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2]), width: 5, height: 5, format: "png" },
      ]);

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      expect(results).toHaveLength(2);
      createdFigureIds.push(...results.map((r) => r.id));
    });

    it("skips figures without page numbers (no real image match possible)", async () => {
      const { course } = await makeFixture();
      mockExtractFigures.mockResolvedValueOnce([
        { caption: "Figura 3: Sin pagina", pageNum: null },
      ]);

      const results = await extractor.extractAndSave(fakeBuffer, course.id);

      // v1.0: null pageNum can't match an image on a page → skipped.
      expect(results).toEqual([]);
    });
  });
});

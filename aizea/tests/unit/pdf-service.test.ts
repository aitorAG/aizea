import { describe, it, expect, vi, beforeEach } from "vitest";
import { PDFService, PDFExtractResult } from "@/lib/domain/pdf/PDFService";

const mockPdfParse = vi.hoisted(() =>
  vi.fn<(_buffer: Buffer) => Promise<{ text: string; numpages: number; metadata?: Record<string, unknown> }>>(() =>
    Promise.resolve({
      text: "Sample PDF text with Figura 1: Overview and Figure 2.1: Details.",
      numpages: 3,
      metadata: { Title: "Test", Author: "Dev" },
    })
  )
);

vi.mock("pdf-parse", () => ({
  default: mockPdfParse,
}));

describe("PDFService", () => {
  let service: PDFService;
  let fakeBuffer: Buffer;

  beforeEach(() => {
    service = new PDFService();
    fakeBuffer = Buffer.from("fake-pdf-content");
    mockPdfParse.mockClear();
  });

  describe("extractText", () => {
    it("returns text, pages and metadata from pdf-parse", async () => {
      const result = await service.extractText(fakeBuffer);

      expect(mockPdfParse).toHaveBeenCalledWith(fakeBuffer);
      expect(result).toEqual({
        text: "Sample PDF text with Figura 1: Overview and Figure 2.1: Details.",
        pages: 3,
        metadata: { Title: "Test", Author: "Dev" },
      });
    });

    it("defaults metadata to empty object when absent", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "No metadata",
        numpages: 1,
      });

      const result = await service.extractText(fakeBuffer);

      expect(result.metadata).toEqual({});
    });
  });

  describe("extractImages", () => {
    it("returns an empty array (gracefully) for an invalid PDF", async () => {
      const result = await service.extractImages(fakeBuffer);
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([]);
    });

    it("does not throw NotImplementedError anymore", async () => {
      // Replaced in Wave 3 by a real pdf-lib-based implementation
      await expect(service.extractImages(fakeBuffer)).resolves.not.toThrow();
    });
  });

  describe("extractAll", () => {
    it("returns the same result as extractText", async () => {
      const result = await service.extractAll(fakeBuffer);

      expect(mockPdfParse).toHaveBeenCalledWith(fakeBuffer);
      expect(result).toEqual({
        text: "Sample PDF text with Figura 1: Overview and Figure 2.1: Details.",
        pages: 3,
        metadata: { Title: "Test", Author: "Dev" },
      });
    });
  });

  describe("extractFigures", () => {
    it("extracts figure references with captions", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "Figura 1: Diagrama de flujo. Figure 2.1: Detalle del sistema.",
        numpages: 2,
        metadata: {},
      });

      const result = await service.extractFigures(fakeBuffer);

      expect(result).toEqual([
        { caption: "Figura 1: Diagrama de flujo", pageNum: null },
        { caption: "Figura 2.1: Detalle del sistema", pageNum: null },
      ]);
    });

    it("deduplicates repeated figure references", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "Figura 1: A. Later Figura 1: A.",
        numpages: 1,
        metadata: {},
      });

      const result = await service.extractFigures(fakeBuffer);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ caption: "Figura 1: A", pageNum: null });
    });

    it("returns empty array when no figure references are present", async () => {
      mockPdfParse.mockResolvedValueOnce({
        text: "Just plain text without any figures.",
        numpages: 1,
        metadata: {},
      });

      const result = await service.extractFigures(fakeBuffer);

      expect(result).toEqual([]);
    });
  });
});

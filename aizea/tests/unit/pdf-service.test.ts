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
    // v1.0 — extractFigures now drives pdf-parse's `pagerender` callback so
    // each caption carries its page. This helper makes the mock invoke
    // pagerender once per supplied page text.
    function mockPages(pages: string[]) {
      mockPdfParse.mockImplementationOnce(
        async (
          _buf: Buffer,
          opts?: {
            pagerender?: (pd: {
              getTextContent: (o: unknown) => Promise<{ items: Array<{ str: string }> }>;
            }) => Promise<string>;
          }
        ) => {
          if (opts?.pagerender) {
            for (const text of pages) {
              await opts.pagerender({
                getTextContent: async () => ({ items: [{ str: text }] }),
              });
            }
          }
          return { text: pages.join("\n"), numpages: pages.length, metadata: {} };
        }
      );
    }

    it("extracts figure references with captions and per-page numbers", async () => {
      mockPages([
        "Figura 1: Diagrama de flujo.",
        "Figure 2.1: Detalle del sistema.",
      ]);

      const result = await service.extractFigures(fakeBuffer);

      expect(result).toEqual([
        { caption: "Figura 1: Diagrama de flujo", pageNum: 1 },
        { caption: "Figura 2.1: Detalle del sistema", pageNum: 2 },
      ]);
    });

    it("deduplicates repeated figure references", async () => {
      mockPages(["Figura 1: A. Later Figura 1: A."]);

      const result = await service.extractFigures(fakeBuffer);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ caption: "Figura 1: A", pageNum: 1 });
    });

    it("returns empty array when no figure references are present", async () => {
      mockPages(["Just plain text without any figures."]);

      const result = await service.extractFigures(fakeBuffer);

      expect(result).toEqual([]);
    });
  });
});

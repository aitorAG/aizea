import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PDFService } from "@/lib/domain/pdf/PDFService";

const { mockContextLookup, mockGetPages, mockPDFName, mockSharp } = vi.hoisted(() => ({
  mockContextLookup: vi.fn(),
  mockGetPages: vi.fn(),
  mockPDFName: { of: (s: string) => ({ __pdfname: s }) },
  mockSharp: vi.fn(),
}));

vi.mock("pdf-lib", () => ({
  PDFDocument: {
    load: vi.fn(async (_buf: Buffer) => ({
      getPages: mockGetPages,
      getPage: vi.fn(),
      context: { lookup: mockContextLookup },
    })),
  },
  PDFName: mockPDFName,
  PDFDict: class {},
  PDFStream: class {},
  PDFNumber: class {},
}));

// Mock sharp so the image-compressor call inside PDFService.extractImages
// doesn't try to load real libvips (which is slow / sometimes missing in CI).
vi.mock("sharp", () => ({
  default: mockSharp,
}));

describe("PDFService.extractImages", () => {
  let service: PDFService;

  beforeEach(() => {
    service = new PDFService();
    mockContextLookup.mockReset();
    mockGetPages.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns an empty array when the PDF has no images", async () => {
    mockGetPages.mockReturnValue([]);
    mockContextLookup.mockReturnValue(null);

    const result = await service.extractImages(Buffer.from("fake-pdf"));
    expect(result).toEqual([]);
  });

  it("returns an empty array on parse error (does not throw)", async () => {
    const { PDFDocument } = await import("pdf-lib");
    vi.mocked(PDFDocument.load).mockRejectedValueOnce(new Error("bad pdf"));
    const result = await service.extractImages(Buffer.from("not a pdf"));
    expect(result).toEqual([]);
  });

  it("returns an empty array when pages lack /Resources", async () => {
    const pageNode = {};
    const pageDictInstance = {
      get: vi.fn().mockReturnValue(null),
    };
    mockGetPages.mockReturnValue([{ node: pageNode }]);
    mockContextLookup.mockImplementation((ref: unknown) => {
      if (ref === pageNode) return pageDictInstance;
      return null;
    });

    const result = await service.extractImages(Buffer.from("fake"));
    expect(result).toEqual([]);
  });

  it("skips non-image XObjects", async () => {
    const notImageDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "Subtype") return { toString: () => "/FormXObject" };
        return null;
      }),
    };
    const notImageStream = { dict: notImageDict };

    const xobjectsDict = {
      entries: vi.fn().mockReturnValue([["name", "ref"]]),
    };
    const resourcesDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "XObject") return "xobj-ref";
        return null;
      }),
    };
    const pageDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "Resources") return "res-ref";
        return null;
      }),
    };
    const pageNode = {};

    mockGetPages.mockReturnValue([{ node: pageNode }]);
    mockContextLookup.mockImplementation((ref: unknown) => {
      if (ref === pageNode) return pageDict;
      if (ref === "res-ref") return resourcesDict;
      if (ref === "xobj-ref") return xobjectsDict;
      if (ref === "ref") return notImageStream;
      return null;
    });

    const result = await service.extractImages(Buffer.from("fake"));
    expect(result).toEqual([]);
  });

  it("returns PDFImage[] with id, pageNum, data, width, height, format for image XObjects", async () => {
    const imageDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "Subtype") return { toString: () => "/Image" };
        if (key?.__pdfname === "Width") return { asNumber: () => 200, numberValue: 200 };
        if (key?.__pdfname === "Height") return { asNumber: () => 100, numberValue: 100 };
        if (key?.__pdfname === "Filter") return null;
        return null;
      }),
    };
    const imageStream = {
      dict: imageDict,
      getContents: vi.fn().mockReturnValue(Buffer.from("PNG-FAKE")),
    };

    const xobjectsDict = {
      entries: vi.fn().mockReturnValue([["Im1", "imgref"]]),
    };
    const resourcesDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "XObject") return "xobj-ref";
        return null;
      }),
    };
    const pageDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "Resources") return "res-ref";
        return null;
      }),
    };
    const pageNode = {};

    mockGetPages.mockReturnValue([{ node: pageNode }]);
    mockContextLookup.mockImplementation((ref: unknown) => {
      if (ref === pageNode) return pageDict;
      if (ref === "res-ref") return resourcesDict;
      if (ref === "xobj-ref") return xobjectsDict;
      if (ref === "imgref") return imageStream;
      return null;
    });

    const result = await service.extractImages(Buffer.from("fake"));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: expect.any(String),
      pageNum: 1,
      data: expect.any(Buffer),
      width: 200,
      height: 100,
      format: expect.any(String),
    });
  });

  it("uses the page's DCTDecode filter to skip WebP compression", async () => {
    const imageDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "Subtype") return { toString: () => "/Image" };
        if (key?.__pdfname === "Width") return { asNumber: () => 50, numberValue: 50 };
        if (key?.__pdfname === "Height") return { asNumber: () => 50, numberValue: 50 };
        if (key?.__pdfname === "Filter") return { toString: () => "/DCTDecode" };
        return null;
      }),
    };
    const imageStream = {
      dict: imageDict,
      getContents: vi.fn().mockReturnValue(Buffer.from("JPEG-FAKE")),
    };
    const xobjectsDict = {
      entries: vi.fn().mockReturnValue([["Im1", "imgref"]]),
    };
    const resourcesDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "XObject") return "xobj-ref";
        return null;
      }),
    };
    const pageDict = {
      get: vi.fn((key: { __pdfname?: string }) => {
        if (key?.__pdfname === "Resources") return "res-ref";
        return null;
      }),
    };
    const pageNode = {};

    mockGetPages.mockReturnValue([{ node: pageNode }]);
    mockContextLookup.mockImplementation((ref: unknown) => {
      if (ref === pageNode) return pageDict;
      if (ref === "res-ref") return resourcesDict;
      if (ref === "xobj-ref") return xobjectsDict;
      if (ref === "imgref") return imageStream;
      return null;
    });

    const result = await service.extractImages(Buffer.from("fake"));
    expect(result[0].format).toBe("DCTDecode");
  });
});

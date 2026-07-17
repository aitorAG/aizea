import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LayoutParser, DoclingUnreachableError } from "@/lib/domain/pdf/LayoutParser";
import type { DocumentStructure } from "@/lib/types/pipeline";

const mockFetch = vi.hoisted(() => vi.fn());

// Stub global fetch
globalThis.fetch = mockFetch as unknown as typeof globalThis.fetch;

const SAMPLE_DOCUMENT_JSON = {
  schema_name: "DoclingDocument",
  version: "1.0.0",
  name: "test.pdf",
  pages: [
    { page_no: 1, size: { width: 595, height: 842 } },
    { page_no: 2, size: { width: 595, height: 842 } },
    { page_no: 3, size: { width: 595, height: 842 } },
    { page_no: 4, size: { width: 595, height: 842 } },
    { page_no: 5, size: { width: 595, height: 842 } },
  ],
  body: {
    children: [
      {
        self_ref: "#/body/0",
        label: "chapter",
        name: "group",
        content_layer: "body",
        children: [
          {
            self_ref: "#/body/0/0",
            label: "section",
            name: "group",
            content_layer: "body",
            children: [
              {
                self_ref: "#/body/0/0/0",
                label: "title",
                name: "section_header",
                content_layer: "body",
                level: 1,
                text: "1. Introduction",
                prov: [{ page_no: 1 }],
              },
            ],
          },
          {
            self_ref: "#/body/0/1",
            label: "section",
            name: "group",
            content_layer: "body",
            children: [
              {
                self_ref: "#/body/0/1/0",
                label: "title",
                name: "section_header",
                content_layer: "body",
                level: 1,
                text: "2. Thermodynamics",
                prov: [{ page_no: 2 }],
              },
              {
                self_ref: "#/body/0/1/1",
                label: "title",
                name: "section_header",
                content_layer: "body",
                level: 2,
                text: "2.1 First Law",
                prov: [{ page_no: 3 }],
              },
              {
                self_ref: "#/body/0/1/2",
                label: "title",
                name: "section_header",
                content_layer: "body",
                level: 2,
                text: "2.2 Second Law",
                prov: [{ page_no: 4 }],
              },
            ],
          },
          {
            self_ref: "#/body/0/2",
            label: "section",
            name: "group",
            content_layer: "body",
            children: [
              {
                self_ref: "#/body/0/2/0",
                label: "title",
                name: "section_header",
                content_layer: "body",
                level: 1,
                text: "3. Conclusions",
                prov: [{ page_no: 5 }],
              },
            ],
          },
        ],
      },
    ],
  },
};

function mockDoclingResponse(document: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve({ document: { json_content: document } }),
  };
}

describe("LayoutParser", () => {
  let parser: LayoutParser;
  const originalEnv = process.env.DOCLING_SERVE_URL;

  beforeEach(() => {
    parser = new LayoutParser({ baseUrl: "http://docling.test:5001" });
    mockFetch.mockReset();
    delete process.env.DOCLING_SERVE_URL;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DOCLING_SERVE_URL;
    } else {
      process.env.DOCLING_SERVE_URL = originalEnv;
    }
  });

  describe("constructor", () => {
    it("uses provided baseUrl when given", () => {
      const p = new LayoutParser({ baseUrl: "http://x:1234" });
      expect((p as unknown as { baseUrl: string }).baseUrl).toBe(
        "http://x:1234"
      );
    });

    it("falls back to DOCLING_SERVE_URL env var", () => {
      process.env.DOCLING_SERVE_URL = "http://env-host:9999";
      const p = new LayoutParser();
      expect((p as unknown as { baseUrl: string }).baseUrl).toBe(
        "http://env-host:9999"
      );
    });

    it("falls back to http://localhost:5001 when no config", () => {
      const p = new LayoutParser();
      expect((p as unknown as { baseUrl: string }).baseUrl).toBe(
        "http://localhost:5001"
      );
    });
  });

  describe("parse", () => {
    it("returns a DocumentStructure with sections from DoclingDocument JSON", async () => {
      mockFetch.mockResolvedValueOnce(mockDoclingResponse(SAMPLE_DOCUMENT_JSON));

      const result = await parser.parse(
        Buffer.from("fake"),
        "test.pdf"
      );

      expect(result).toMatchObject<Partial<DocumentStructure>>({
        filename: "test.pdf",
        pageCount: 5,
        hasStructuralMarkup: true,
      });
      // 5 section_header items in the sample: 1, 2, 2.1, 2.2, 3
      expect(result.sections).toHaveLength(5);
      expect(result.toc).toHaveLength(5);
    });

    it("marks hasStructuralMarkup=false when no section_header items", async () => {
      const noHeaders = {
        ...SAMPLE_DOCUMENT_JSON,
        body: { children: [] },
      };
      mockFetch.mockResolvedValueOnce(mockDoclingResponse(noHeaders));

      const result = await parser.parse(Buffer.from("fake"), "scan.pdf");

      expect(result.hasStructuralMarkup).toBe(false);
      expect(result.sections).toEqual([]);
      expect(result.toc).toEqual([]);
      expect(result.pageCount).toBe(5);
    });

    it("extracts hierarchical numbering from titles like '2.1.3'", async () => {
      mockFetch.mockResolvedValueOnce(mockDoclingResponse(SAMPLE_DOCUMENT_JSON));

      const result = await parser.parse(Buffer.from("fake"), "test.pdf");

      const intro = result.sections.find((s) => s.title === "1. Introduction");
      expect(intro?.numbering).toBe("1");

      const thermo = result.sections.find((s) => s.title === "2. Thermodynamics");
      expect(thermo?.numbering).toBe("2");

      const firstLaw = result.sections.find((s) => s.title === "2.1 First Law");
      expect(firstLaw?.numbering).toBe("2.1");

      const secondLaw = result.sections.find((s) => s.title === "2.2 Second Law");
      expect(secondLaw?.numbering).toBe("2.2");
    });

    it("leaves numbering as null when title has no number", async () => {
      const noNumber = {
        ...SAMPLE_DOCUMENT_JSON,
        body: {
          children: [
            {
              self_ref: "#/body/0",
              label: "section",
              name: "group",
              content_layer: "body",
              children: [
                {
                  self_ref: "#/body/0/0",
                  label: "title",
                  name: "section_header",
                  content_layer: "body",
                  level: 1,
                  text: "Introduction",
                  prov: [{ page_no: 1 }],
                },
              ],
            },
          ],
        },
      };
      mockFetch.mockResolvedValueOnce(mockDoclingResponse(noNumber));

      const result = await parser.parse(Buffer.from("fake"), "test.pdf");

      expect(result.sections[0].numbering).toBeNull();
      expect(result.sections[0].title).toBe("Introduction");
    });

    it("extracts level from section_header items", async () => {
      mockFetch.mockResolvedValueOnce(mockDoclingResponse(SAMPLE_DOCUMENT_JSON));

      const result = await parser.parse(Buffer.from("fake"), "test.pdf");

      const firstLaw = result.sections.find((s) => s.title === "2.1 First Law");
      expect(firstLaw?.level).toBe(1);
      const thermo = result.sections.find((s) => s.title === "2. Thermodynamics");
      expect(thermo?.level).toBe(0);
    });

    it("maps page numbers from prov[].page_no", async () => {
      mockFetch.mockResolvedValueOnce(mockDoclingResponse(SAMPLE_DOCUMENT_JSON));

      const result = await parser.parse(Buffer.from("fake"), "test.pdf");

      const intro = result.sections.find((s) => s.title === "1. Introduction");
      expect(intro?.pageStart).toBe(1);
    });

    it("calls docling-serve /v1/convert/file with multipart form data", async () => {
      mockFetch.mockResolvedValueOnce(mockDoclingResponse(SAMPLE_DOCUMENT_JSON));

      await parser.parse(Buffer.from("PDF CONTENT"), "test.pdf");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://docling.test:5001/v1/convert/file");
      expect(init.method).toBe("POST");
      expect(init.body).toBeInstanceOf(FormData);
      const form = init.body as FormData;
      expect(form.get("to_formats")).toBe("json");
      expect(form.get("from_formats")).toBe("pdf");
    });

    it("throws DoclingUnreachableError on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(parser.parse(Buffer.from("x"), "x.pdf")).rejects.toThrow(
        DoclingUnreachableError
      );
    });

    it("throws DoclingUnreachableError on 5xx response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({}),
      });

      await expect(parser.parse(Buffer.from("x"), "x.pdf")).rejects.toThrow(
        DoclingUnreachableError
      );
    });

    it("propagates a useful error on 4xx response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: "Unprocessable Entity",
        json: () => Promise.resolve({ detail: "bad pdf" }),
      });

      await expect(parser.parse(Buffer.from("x"), "x.pdf")).rejects.toThrow(
        /422.*Unprocessable Entity/
      );
    });

    it("sends a non-multipart payload (buffer is in FormData as file)", async () => {
      mockFetch.mockResolvedValueOnce(mockDoclingResponse(SAMPLE_DOCUMENT_JSON));

      const buf = Buffer.from("PDF BYTES");
      await parser.parse(buf, "doc.pdf");

      const form = (mockFetch.mock.calls[0] as [string, RequestInit])[1]
        .body as FormData;
      const file = form.get("files");
      expect(file).toBeInstanceOf(Blob);
      // Read blob back to verify content
      const blob = file as Blob;
      const text = await blob.text();
      expect(text).toBe("PDF BYTES");
      expect(form.get("target_type")).toBe("inbody");
    });
  });

  describe("checkHealth", () => {
    it("returns true when /health returns 200", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ status: "ok" }),
      });
      await expect(parser.checkHealth()).resolves.toBe(true);
    });

    it("returns false on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
      await expect(parser.checkHealth()).resolves.toBe(false);
    });

    it("returns false on 5xx", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        json: () => Promise.resolve({}),
      });
      await expect(parser.checkHealth()).resolves.toBe(false);
    });
  });
});

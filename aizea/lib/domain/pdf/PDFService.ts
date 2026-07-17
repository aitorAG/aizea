import pdfParse from "pdf-parse";
import { PDFServiceTauri } from "./PDFServiceTauri";
import { compressToWebP } from "@/lib/domain/utils/image-compressor";
import { PDFDocument, PDFDict, PDFStream, PDFNumber, PDFName } from "pdf-lib";
import { randomUUID } from "node:crypto";

export interface PDFExtractResult {
  text: string;
  pages: number;
  metadata: Record<string, unknown>;
}

export interface PDFImage {
  id: string;
  pageNum: number;
  data: Buffer;
  width: number;
  height: number;
  format: string;
}

export class NotImplementedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not implemented yet`);
    this.name = "NotImplementedError";
  }
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    (window as unknown as Record<string, unknown>).__TAURI__ !== undefined
  );
}

class PDFServiceJS {
  async extractText(buffer: Buffer): Promise<PDFExtractResult> {
    const data = await pdfParse(buffer);
    return {
      text: data.text,
      pages: data.numpages,
      metadata: data.metadata ?? {},
    };
  }

  /**
   * Extract embedded raster images from a PDF using pdf-lib's object graph.
   *
   * Walks every page's `/Resources/XObject` entries, picks the ones whose
   * `/Subtype` is `/Image`, and decodes their content streams. We compress
   * large images with the shared image-compressor (WebP) to keep the figure
   * table small.
   *
   * Returns an empty array on any error so callers can degrade gracefully
   * (FigureExtractor already falls back to a tiny placeholder PNG).
   */
  async extractImages(buffer: Buffer): Promise<PDFImage[]> {
    let pdfDoc: Awaited<ReturnType<typeof PDFDocument.load>>;
    try {
      pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    } catch (err) {
      console.warn(
        "[PDFService] extractImages: failed to load PDF:",
        err instanceof Error ? err.message : err
      );
      return [];
    }

    const results: PDFImage[] = [];
    const pages = pdfDoc.getPages();
    const ctx = pdfDoc.context;

    for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
      const page = pages[pageIdx];
      const pageNode = page.node;
      const pageDict = ctx.lookup(pageNode) as PDFDict | undefined;
      if (!pageDict) continue;
      if (typeof (pageDict as { get?: unknown }).get !== "function") continue;

      const resourcesRef = (pageDict as { get: (n: unknown) => unknown }).get(
        PDFName.of("Resources")
      );
      if (!resourcesRef) continue;

      const resources = ctx.lookup(resourcesRef as Parameters<typeof ctx.lookup>[0]) as { get?: (n: unknown) => unknown } | null;
      if (!resources || typeof resources.get !== "function") continue;

      const xobjectRef = resources.get(PDFName.of("XObject"));
      if (!xobjectRef) continue;

      const xobjects = ctx.lookup(xobjectRef as Parameters<typeof ctx.lookup>[0]) as
        | { entries?: () => Iterable<[unknown, unknown]> }
        | null;
      if (!xobjects || typeof xobjects.entries !== "function") continue;

      for (const [, ref] of xobjects.entries()) {
        const xobj = ctx.lookup(ref as Parameters<typeof ctx.lookup>[0]) as
          | (PDFStream & { getContents(): Uint8Array })
          | PDFDict
          | null
          | undefined;
        if (!xobj) continue;

        // PDFStream has `.dict` and `.getContents()`. Duck-type both.
        const xobjDict =
          xobj && typeof (xobj as PDFStream).dict !== "undefined"
            ? (xobj as PDFStream).dict
            : (xobj as PDFDict);
        if (!xobjDict || typeof (xobjDict as { get?: unknown }).get !== "function") continue;

        const dictGet = (xobjDict as { get: (n: unknown) => unknown }).get;
        const subtype = dictGet(PDFName.of("Subtype"));
        if (!subtype || subtype.toString() !== "/Image") continue;

        const widthRaw = dictGet(PDFName.of("Width"));
        const heightRaw = dictGet(PDFName.of("Height"));
        const width =
          widthRaw instanceof PDFNumber
            ? widthRaw.asNumber()
            : (widthRaw && typeof (widthRaw as unknown as { numberValue?: number }).numberValue === "number"
              ? (widthRaw as unknown as { numberValue: number }).numberValue
              : 0);
        const height =
          heightRaw instanceof PDFNumber
            ? heightRaw.asNumber()
            : (heightRaw && typeof (heightRaw as unknown as { numberValue?: number }).numberValue === "number"
              ? (heightRaw as unknown as { numberValue: number }).numberValue
              : 0);

        const filterRaw = dictGet(PDFName.of("Filter"));
        const filter = filterRaw ? filterRaw.toString().replace(/^\//, "") : "raw";

        let raw: Buffer;
        try {
          if (typeof (xobj as PDFStream).getContents !== "function") {
            console.warn(
              `[PDFService] extractImages: xObject has no getContents() on page ${pageIdx + 1}, skipping`
            );
            continue;
          }
          const contents = (xobj as PDFStream).getContents();
          raw = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
        } catch (err) {
          console.warn(
            `[PDFService] extractImages: failed to read image stream on page ${pageIdx + 1}:`,
            err instanceof Error ? err.message : err
          );
          continue;
        }

        // Compress large images as WebP. For images with exotic filters
        // (DCTDecode/JPXDecode) we leave them as-is — sharp can't decode them
        // without an extra plugin and the bytes are already compressed.
        const isCompressedByPdf = ["DCTDecode", "JPXDecode", "CCITTFaxDecode", "JBIG2Decode"].includes(filter);
        const data = isCompressedByPdf ? raw : await compressToWebP(raw).catch(() => raw);

        results.push({
          id: randomUUID(),
          pageNum: pageIdx + 1,
          data,
          width,
          height,
          format: isCompressedByPdf ? filter : "webp",
        });
      }
    }

    return results;
  }

  async extractAll(buffer: Buffer): Promise<PDFExtractResult> {
    return this.extractText(buffer);
  }

  async extractFigures(
    buffer: Buffer
  ): Promise<Array<{ caption: string; pageNum: number | null }>> {
    const { text } = await this.extractText(buffer);

    const results: Array<{ caption: string; pageNum: number | null }> = [];
    const seen = new Set<string>();

    const regex = /(?:Figura|Figure)\s+(\d+(?:\.\d+)?)[.:]?\s*([^\n.]*)/gi;

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const figureNum = match[1];
      const captionText = match[2].trim();
      const caption = captionText
        ? `Figura ${figureNum}: ${captionText}`
        : `Figura ${figureNum}`;

      if (!seen.has(caption)) {
        seen.add(caption);
        results.push({ caption, pageNum: null });
      }
    }

    return results;
  }
}

// PDFName shim — pdf-lib's public PDFName import is missing in some builds,
// but PDFName.of works on the underlying class.
export class PDFService {
  private backend: PDFServiceJS | PDFServiceTauri;

  constructor() {
    this.backend = isTauri() ? new PDFServiceTauri() : new PDFServiceJS();
  }

  async extractText(buffer: Buffer): Promise<PDFExtractResult> {
    return this.backend.extractText(buffer);
  }

  async extractImages(buffer: Buffer): Promise<PDFImage[]> {
    return this.backend.extractImages(buffer);
  }

  async extractAll(buffer: Buffer): Promise<PDFExtractResult> {
    return this.backend.extractAll(buffer);
  }

  async extractFigures(
    buffer: Buffer
  ): Promise<Array<{ caption: string; pageNum: number | null }>> {
    return this.backend.extractFigures(buffer);
  }
}

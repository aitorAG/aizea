// figure-geometry.pdflib — pdf-lib adapter feeding the pure geometry analyser.
//
// Extracts a page's decoded content stream (single stream or array of streams)
// and its XObject resource metadata (image vs form, form /BBox + /Matrix), then
// delegates to `computeDrawingBbox`. Kept separate from the pure module so the
// geometry logic stays dependency-free and unit-testable.

import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRawStream,
  PDFNumber,
  decodePDFRawStream,
} from "pdf-lib";
import {
  computeDrawingBbox,
  computeDrawingElements,
  type Bbox,
  type Matrix,
  type XObjectInfo,
} from "@/lib/domain/pdf/figure-geometry";

/** Decoded page geometry result. */
export interface PageGeometry {
  /** Page size in points (user space). */
  width: number;
  height: number;
  /** Drawing bbox in user space (origin bottom-left), or null if text-only. */
  drawingBbox: Bbox | null;
  /** Individual drawing elements (per subpath/rect/xobject) for clustering. */
  drawingElements: Bbox[];
}

function streamToString(stream: PDFRawStream): string {
  try {
    const bytes = decodePDFRawStream(stream).decode();
    return Buffer.from(bytes).toString("latin1");
  } catch {
    // Undecodable stream (unknown filter) → treat as empty content.
    return "";
  }
}

function readNumberArray(arr: PDFArray | undefined, len: number): number[] | undefined {
  if (!arr || arr.size() < len) return undefined;
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const v = arr.get(i);
    if (v instanceof PDFNumber) out.push(v.asNumber());
    else return undefined;
  }
  return out;
}

/**
 * Compute the drawing bbox for a single page (0-based index) of a loaded PDF.
 * Returns null when the page has no drawing geometry (text-only) or on error.
 */
export function computePageGeometry(
  doc: PDFDocument,
  pageIndex: number
): PageGeometry | null {
  const pages = doc.getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) return null;
  const page = pages[pageIndex];
  const ctx = doc.context;
  const { width, height } = page.getSize();

  // 1. Gather the content stream(s).
  let content = "";
  const contentsRef = page.node.get(PDFName.of("Contents"));
  const contents = contentsRef ? ctx.lookup(contentsRef) : undefined;
  if (contents instanceof PDFRawStream) {
    content = streamToString(contents);
  } else if (contents instanceof PDFArray) {
    const parts: string[] = [];
    for (let i = 0; i < contents.size(); i++) {
      const s = ctx.lookup(contents.get(i));
      if (s instanceof PDFRawStream) parts.push(streamToString(s));
    }
    content = parts.join("\n");
  }
  if (!content) return { width, height, drawingBbox: null, drawingElements: [] };

  // 2. Gather XObject metadata from the page Resources.
  const xobjects: Record<string, XObjectInfo> = {};
  const resourcesRef = page.node.get(PDFName.of("Resources"));
  const resources = resourcesRef ? ctx.lookup(resourcesRef) : undefined;
  if (resources instanceof PDFDict) {
    const xobjRef = resources.get(PDFName.of("XObject"));
    const xobjDict = xobjRef ? ctx.lookup(xobjRef) : undefined;
    if (xobjDict instanceof PDFDict) {
      for (const [key, ref] of xobjDict.entries()) {
        const name = key.asString().replace(/^\//, "");
        const xobj = ctx.lookup(ref);
        const dict =
          xobj instanceof PDFRawStream
            ? xobj.dict
            : xobj instanceof PDFDict
              ? xobj
              : undefined;
        if (!dict) continue;
        const subtype = dict.get(PDFName.of("Subtype"));
        const subtypeStr = subtype ? subtype.toString() : "";
        if (subtypeStr === "/Image") {
          xobjects[name] = { type: "image" };
        } else if (subtypeStr === "/Form") {
          const bboxArr = ctx.lookup(dict.get(PDFName.of("BBox")));
          const bboxNums = readNumberArray(
            bboxArr instanceof PDFArray ? bboxArr : undefined,
            4
          );
          const matrixArr = ctx.lookup(dict.get(PDFName.of("Matrix")));
          const matrixNums = readNumberArray(
            matrixArr instanceof PDFArray ? matrixArr : undefined,
            6
          );
          xobjects[name] = {
            type: "form",
            formBbox: bboxNums
              ? { x0: bboxNums[0], y0: bboxNums[1], x1: bboxNums[2], y1: bboxNums[3] }
              : undefined,
            formMatrix: matrixNums ? (matrixNums as Matrix) : undefined,
          };
        }
      }
    }
  }

  const drawingElements = computeDrawingElements(content, xobjects);
  const drawingBbox = computeDrawingBbox(content, xobjects);
  return { width, height, drawingBbox, drawingElements };
}

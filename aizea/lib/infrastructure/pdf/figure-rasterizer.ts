// FigureRasterizer — infra implementation of IFigureRasterizer (v1.0, Opción B).
//
// Combines the two building blocks:
//   1. figure-geometry.pdflib → computes the figure's bounding box from the PDF
//      page content stream (drawing geometry, excluding body text).
//   2. page-rasterizer (pdfium-wasm + pngjs) → renders the page and crops to
//      that bbox, producing a PNG.
//
// Fully in-process: no docling, no Docker, no native binary. Ships in the
// desktop .exe's bundled Node runtime.

import { PDFDocument } from "pdf-lib";
import { computePageGeometry } from "@/lib/infrastructure/pdf/figure-geometry.pdflib";
import { rasterizeAndCrop } from "@/lib/infrastructure/pdf/page-rasterizer";
import type {
  IFigureRasterizer,
  RasterizedFigure,
} from "@/lib/application/ports/figure-rasterizer.port";

export class FigureRasterizer implements IFigureRasterizer {
  async rasterizeFigure(
    pdfBuffer: Buffer,
    pageNum: number
  ): Promise<RasterizedFigure | null> {
    const pageIndex = pageNum - 1; // pageNum is 1-based; pdf-lib is 0-based.
    if (pageIndex < 0) return null;

    // 1. Compute the drawing bbox for the page.
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    } catch {
      return null;
    }
    const geometry = computePageGeometry(doc, pageIndex);
    if (!geometry) return null;

    // No drawing geometry (text-only page) → nothing to crop as a figure.
    if (!geometry.drawingBbox) return null;

    // 2. Rasterise + crop to the bbox.
    const result = await rasterizeAndCrop(pdfBuffer, {
      pageIndex,
      bbox: geometry.drawingBbox,
      scale: 2,
      paddingPt: 6,
    });
    if (!result) return null;

    return { png: result.png, width: result.width, height: result.height };
  }
}

// FigureRasterizer — infra implementation of IFigureRasterizer (v1.0, Opción B).
//
// Combines the building blocks:
//   1. figure-geometry.pdflib → per-page drawing elements + union bbox from the
//      PDF content stream (drawing geometry, excluding body text).
//   2. figure-geometry.clusterBboxes → groups elements into spatial clusters
//      (distinct figures) when a page has several captions.
//   3. page-rasterizer (pdfium-wasm + pngjs) → renders the page ONCE and crops
//      each figure region to a PNG.
//
// Fully in-process: no docling, no Docker, no native binary. Ships in the
// desktop .exe's bundled Node runtime.

import { PDFDocument } from "pdf-lib";
import { computePageGeometry } from "@/lib/infrastructure/pdf/figure-geometry.pdflib";
import { clusterBboxes, type Bbox } from "@/lib/domain/pdf/figure-geometry";
import { rasterizeAndCropMany } from "@/lib/infrastructure/pdf/page-rasterizer";
import type {
  IFigureRasterizer,
  RasterizedFigure,
} from "@/lib/application/ports/figure-rasterizer.port";

export class FigureRasterizer implements IFigureRasterizer {
  async rasterizeFigures(
    pdfBuffer: Buffer,
    pageNum: number,
    expectedCount: number
  ): Promise<RasterizedFigure[]> {
    const pageIndex = pageNum - 1; // pageNum is 1-based; pdf-lib is 0-based.
    if (pageIndex < 0 || expectedCount < 1) return [];

    // 1. Page geometry (elements + union bbox).
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    } catch {
      return [];
    }
    const geometry = computePageGeometry(doc, pageIndex);
    if (!geometry || !geometry.drawingBbox) return [];

    // 2. Decide the crop regions.
    //    - 1 caption  → the whole page's drawing bbox (robust to fragmented
    //      figures split across many subpaths).
    //    - ≥2 captions → spatial clusters (distinct figures), capped at the
    //      caption count, in reading order.
    let regions: Bbox[];
    if (expectedCount === 1) {
      regions = [geometry.drawingBbox];
    } else {
      const clusters = clusterBboxes(geometry.drawingElements, {
        gap: 18,
        pageWidth: geometry.width,
        pageHeight: geometry.height,
        maxClusters: expectedCount,
        // Ignore specks smaller than ~1/3" square (rules, ticks, bullets).
        minArea: 24 * 24,
      });
      regions = clusters.length > 0 ? clusters : [geometry.drawingBbox];
    }

    // 3. Render once, crop each region.
    const crops = await rasterizeAndCropMany(pdfBuffer, pageIndex, regions, {
      scale: 2,
      paddingPt: 6,
    });
    if (!crops) return [];

    const out: RasterizedFigure[] = [];
    for (const c of crops) {
      if (c) out.push({ png: c.png, width: c.width, height: c.height });
    }
    return out;
  }
}

import { describe, it, expect } from "vitest";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { PNG } from "pngjs";
import { computePageGeometry } from "@/lib/infrastructure/pdf/figure-geometry.pdflib";
import { rasterizeAndCrop } from "@/lib/infrastructure/pdf/page-rasterizer";
import { FigureRasterizer } from "@/lib/infrastructure/pdf/figure-rasterizer";

// A4 portrait in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
// Vector figure placement (user space, origin bottom-left).
const FX = 180;
const FY = 400;
const FW = 240;
const FH = 180;

async function authorVectorFigurePdf(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  // Body text near the top (must NOT be included in the figure bbox).
  page.drawText("1. Introduccion", { x: 40, y: PAGE_H - 60, size: 18, font });
  page.drawText("Texto de cuerpo del documento de prueba.", {
    x: 40,
    y: PAGE_H - 90,
    size: 12,
    font,
  });
  // Vector figure: filled rect + two diagonal lines (a drawn diagram).
  page.drawRectangle({
    x: FX,
    y: FY,
    width: FW,
    height: FH,
    borderColor: rgb(0, 0, 0),
    borderWidth: 2,
    color: rgb(0.85, 0.9, 1),
  });
  page.drawLine({
    start: { x: FX, y: FY },
    end: { x: FX + FW, y: FY + FH },
    thickness: 2,
    color: rgb(0.8, 0, 0),
  });
  page.drawLine({
    start: { x: FX, y: FY + FH },
    end: { x: FX + FW, y: FY },
    thickness: 2,
    color: rgb(0, 0.6, 0),
  });
  page.drawText("Figura 1: diagrama vectorial de prueba", {
    x: FX,
    y: FY - 24,
    size: 11,
    font,
  });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}

describe("figure fine-crop (Opción B) — real vector-figure PDF", () => {
  it("computes a drawing bbox that covers the figure, not the whole page", async () => {
    const pdf = await authorVectorFigurePdf();
    const doc = await PDFDocument.load(pdf);
    const geo = computePageGeometry(doc, 0);

    expect(geo).not.toBeNull();
    expect(geo!.drawingBbox).not.toBeNull();
    const b = geo!.drawingBbox!;

    // The bbox must tightly bound the drawn figure (rect + diagonals), i.e.
    // roughly x∈[FX,FX+FW], y∈[FY,FY+FH]. Allow a small tolerance for stroke
    // width. Crucially it must NOT reach the body-text region near the top
    // (y ≈ PAGE_H-60 ≈ 782) — text is excluded from the drawing geometry.
    expect(b.x0).toBeGreaterThanOrEqual(FX - 5);
    expect(b.x0).toBeLessThan(FX + 20);
    expect(b.x1).toBeLessThanOrEqual(FX + FW + 5);
    expect(b.x1).toBeGreaterThan(FX + FW - 20);
    expect(b.y0).toBeGreaterThanOrEqual(FY - 5);
    expect(b.y1).toBeLessThanOrEqual(FY + FH + 5);
    // Not the whole page.
    expect(b.y1).toBeLessThan(PAGE_H - 100);
  });

  it("rasterises and crops the figure to a PNG far smaller than the full page", async () => {
    const pdf = await authorVectorFigurePdf();
    const doc = await PDFDocument.load(pdf);
    const geo = computePageGeometry(doc, 0)!;

    const scale = 2;
    const res = await rasterizeAndCrop(pdf, {
      pageIndex: 0,
      bbox: geo.drawingBbox,
      scale,
      paddingPt: 6,
    });

    expect(res).not.toBeNull();
    const { png, width, height } = res!;

    // Valid PNG that pngjs can decode back.
    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBe(width);
    expect(decoded.height).toBe(height);

    // Crop dimensions ≈ (FW + 2·padding)·scale × (FH + 2·padding)·scale.
    const expectedW = (FW + 12) * scale;
    const expectedH = (FH + 12) * scale;
    expect(width).toBeGreaterThan(expectedW * 0.8);
    expect(width).toBeLessThan(expectedW * 1.25);
    expect(height).toBeGreaterThan(expectedH * 0.8);
    expect(height).toBeLessThan(expectedH * 1.25);

    // The crop must be a real fraction of the full page raster, not the whole
    // page: full page ≈ PAGE_W·scale × PAGE_H·scale.
    const fullW = PAGE_W * scale;
    const fullH = PAGE_H * scale;
    expect(width).toBeLessThan(fullW * 0.75);
    expect(height).toBeLessThan(fullH * 0.5);

    // The crop must contain non-white pixels (the drawn figure), i.e. it is not
    // a blank region.
    let nonWhite = 0;
    for (let i = 0; i < decoded.data.length; i += 4) {
      const r = decoded.data[i];
      const g = decoded.data[i + 1];
      const bl = decoded.data[i + 2];
      if (r < 240 || g < 240 || bl < 240) nonWhite++;
    }
    expect(nonWhite).toBeGreaterThan(100);
  });

  it("returns null bbox for a text-only page (no figure to crop)", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.drawText("Solo texto, sin figuras.", { x: 40, y: 700, size: 14, font });
    const bytes = Buffer.from(await doc.save());

    const loaded = await PDFDocument.load(bytes);
    const geo = computePageGeometry(loaded, 0);
    expect(geo).not.toBeNull();
    expect(geo!.drawingBbox).toBeNull();
  });
});

describe("figure fine-crop — TWO figures on one page (real PDF, clustering)", () => {
  // Two well-separated vector figures on one A4 page, each with a caption.
  async function authorTwoFigurePdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([PAGE_W, PAGE_H]);
    // Figure A — upper area.
    page.drawRectangle({
      x: 150,
      y: 600,
      width: 200,
      height: 120,
      borderColor: rgb(0, 0, 0),
      borderWidth: 2,
      color: rgb(0.9, 0.9, 1),
    });
    page.drawLine({
      start: { x: 150, y: 600 },
      end: { x: 350, y: 720 },
      thickness: 2,
      color: rgb(0.8, 0, 0),
    });
    page.drawText("Figura 1: superior", { x: 150, y: 584, size: 11, font });
    // Figure B — lower area, clearly separated (>18pt gap).
    page.drawRectangle({
      x: 150,
      y: 200,
      width: 220,
      height: 140,
      borderColor: rgb(0, 0, 0),
      borderWidth: 2,
      color: rgb(0.9, 1, 0.9),
    });
    page.drawLine({
      start: { x: 150, y: 340 },
      end: { x: 370, y: 200 },
      thickness: 2,
      color: rgb(0, 0.6, 0),
    });
    page.drawText("Figura 2: inferior", { x: 150, y: 184, size: 11, font });
    return Buffer.from(await doc.save());
  }

  it("clusters the page into two distinct figure crops in reading order", async () => {
    const pdf = await authorTwoFigurePdf();
    const rasterizer = new FigureRasterizer();
    const crops = await rasterizer.rasterizeFigures(pdf, 1, 2);

    // Two distinct crops produced from a SINGLE page render.
    expect(crops).toHaveLength(2);

    // Each crop is a valid PNG, far smaller than the full page.
    const scale = 2;
    for (const c of crops) {
      const decoded = PNG.sync.read(c.png);
      expect(decoded.width).toBe(c.width);
      expect(decoded.height).toBe(c.height);
      expect(c.width).toBeLessThan(PAGE_W * scale * 0.75);
      expect(c.height).toBeLessThan(PAGE_H * scale * 0.5);
      // Non-blank (contains the drawn figure).
      let nonWhite = 0;
      for (let i = 0; i < decoded.data.length; i += 4) {
        if (
          decoded.data[i] < 240 ||
          decoded.data[i + 1] < 240 ||
          decoded.data[i + 2] < 240
        ) {
          nonWhite++;
        }
      }
      expect(nonWhite).toBeGreaterThan(100);
    }

    // The two crops are different images (top figure vs bottom figure).
    expect(Buffer.from(crops[0].png).equals(Buffer.from(crops[1].png))).toBe(false);
  });

  it("with expectedCount 1, returns a single crop covering BOTH figures (union)", async () => {
    const pdf = await authorTwoFigurePdf();
    const rasterizer = new FigureRasterizer();
    const crops = await rasterizer.rasterizeFigures(pdf, 1, 1);

    expect(crops).toHaveLength(1);
    // The union spans from figure B's bottom (~200) to figure A's top (~720):
    // height ≈ (720-200+padding)·scale ≈ 1050+ px → taller than either single
    // figure crop, confirming it is the union rather than one figure.
    expect(crops[0].height).toBeGreaterThan((520 - 12) * 2 * 0.8);
  });
});

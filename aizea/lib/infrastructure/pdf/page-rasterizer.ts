// page-rasterizer — renders a PDF page region to a PNG (v1.0, Option B).
//
// Uses @hyzyla/pdfium (WASM, BSD-licensed — safe for commercial distribution
// and works inside the bundled Node runtime of the desktop .exe, unlike the
// optional native `sharp`) to rasterise a page, then crops the raw bitmap to a
// figure's bounding box (computed by figure-geometry from the PDF content
// stream) and encodes the crop to PNG with pngjs (pure JS, no native binary).
//
// This is the desktop-first path for the "fine crop" of figures that have a
// caption but NO extractable embedded raster (vector diagrams / composites),
// which would otherwise be dropped. No docling, no Docker, no native deps.

import { PNG } from "pngjs";
import type { Bbox } from "@/lib/domain/pdf/figure-geometry";

/** Options for cropping a page region to PNG. */
export interface RasterizeCropOptions {
  /** 0-based page index. */
  pageIndex: number;
  /** Figure bbox in PDF user space (origin bottom-left), or null for full page. */
  bbox: Bbox | null;
  /** Render scale (device px per point). Default 2 (~144 DPI). */
  scale?: number;
  /** Padding in points added around the bbox before cropping. Default 6. */
  paddingPt?: number;
}

/** Result of a successful crop. */
export interface RasterizeResult {
  png: Buffer;
  width: number;
  height: number;
}

// Minimal structural types for the pdfium API we use (avoids depending on the
// package's exported classes in the signature, keeps this file test-friendly).
interface PdfiumPageLike {
  getOriginalSize(): { originalWidth: number; originalHeight: number };
  render(opts: { scale?: number; render: "bitmap" }): Promise<{
    width: number;
    height: number;
    data: Uint8Array;
  }>;
}
interface PdfiumDocLike {
  getPage(i: number): PdfiumPageLike;
  destroy(): void;
}
interface PdfiumLibLike {
  loadDocument(buf: Buffer): Promise<PdfiumDocLike>;
  destroy(): void;
}

/** Lazy pdfium loader. Loaded via a dynamic import so the WASM package is only
 *  pulled in when a figure actually needs rasterising, and (via
 *  `serverExternalPackages` in next.config) is treated as external by the Next
 *  standalone build instead of being bundled. Never breaks if absent. */
async function loadPdfium(): Promise<{ init(): Promise<PdfiumLibLike> } | null> {
  try {
    const mod = (await import("@hyzyla/pdfium")) as unknown as {
      PDFiumLibrary: { init(): Promise<PdfiumLibLike> };
    };
    return mod.PDFiumLibrary;
  } catch {
    return null;
  }
}

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Render page `pageIndex` of `pdfBuffer` and crop to `bbox` (PDF user space).
 * Returns null when pdfium is unavailable, the bbox is degenerate, or on error
 * — callers degrade gracefully (skip the figure).
 *
 * The raw bitmap is BGRA (4 bytes/px, top-left origin). The bbox is in PDF user
 * space (bottom-left origin) so the Y axis is flipped during the crop.
 */
/** Raw rendered page bitmap (BGRA, top-left origin). */
interface RenderedBitmap {
  rw: number;
  rh: number;
  data: Uint8Array;
  originalWidth: number;
  originalHeight: number;
}

/** Crop one bbox (PDF user space) out of an already-rendered bitmap → PNG. */
function cropBitmap(
  bmp: RenderedBitmap,
  bbox: Bbox | null,
  padding: number
): RasterizeResult | null {
  const { rw, rh, data, originalWidth, originalHeight } = bmp;
  const sx = rw / originalWidth;
  const sy = rh / originalHeight;

  let dx0 = 0;
  let dy0 = 0;
  let dx1 = rw;
  let dy1 = rh;
  if (bbox) {
    const px0 = (bbox.x0 - padding) * sx;
    const px1 = (bbox.x1 + padding) * sx;
    // Flip Y: user-space y grows up; device y grows down from the top.
    const py0 = (originalHeight - (bbox.y1 + padding)) * sy;
    const py1 = (originalHeight - (bbox.y0 - padding)) * sy;
    dx0 = clamp(Math.floor(px0), 0, rw);
    dx1 = clamp(Math.ceil(px1), 0, rw);
    dy0 = clamp(Math.floor(py0), 0, rh);
    dy1 = clamp(Math.ceil(py1), 0, rh);
  }

  const cw = dx1 - dx0;
  const ch = dy1 - dy0;
  // Reject degenerate / suspiciously tiny crops (< 8px either side).
  if (cw < 8 || ch < 8) return null;

  const png = new PNG({ width: cw, height: ch });
  for (let y = 0; y < ch; y++) {
    const srcRow = (dy0 + y) * rw * 4;
    const dstRow = y * cw * 4;
    for (let x = 0; x < cw; x++) {
      const s = srcRow + (dx0 + x) * 4;
      const d = dstRow + x * 4;
      // BGRA → RGBA
      png.data[d] = data[s + 2];
      png.data[d + 1] = data[s + 1];
      png.data[d + 2] = data[s];
      png.data[d + 3] = data[s + 3];
    }
  }
  return { png: PNG.sync.write(png), width: cw, height: ch };
}

/**
 * Render page `pageIndex` ONCE and crop it to EACH of `bboxes` (PDF user
 * space). Returns one result per input bbox (null for degenerate crops),
 * preserving order. Returns null (whole array unavailable) when pdfium can't
 * load or render. Far cheaper than N separate renders for multi-figure pages.
 */
export async function rasterizeAndCropMany(
  pdfBuffer: Buffer,
  pageIndex: number,
  bboxes: (Bbox | null)[],
  opts: { scale?: number; paddingPt?: number } = {}
): Promise<(RasterizeResult | null)[] | null> {
  const scale = opts.scale ?? 2;
  const padding = opts.paddingPt ?? 6;

  const PDFiumLibrary = await loadPdfium();
  if (!PDFiumLibrary) return null;

  let lib: PdfiumLibLike | null = null;
  let doc: PdfiumDocLike | null = null;
  try {
    lib = await PDFiumLibrary.init();
    doc = await lib.loadDocument(pdfBuffer);
    const page = doc.getPage(pageIndex);
    const { originalWidth, originalHeight } = page.getOriginalSize();
    const render = await page.render({ scale, render: "bitmap" });
    const bmp: RenderedBitmap = {
      rw: render.width,
      rh: render.height,
      data: render.data,
      originalWidth,
      originalHeight,
    };
    return bboxes.map((b) => cropBitmap(bmp, b, padding));
  } catch {
    return null;
  } finally {
    try {
      doc?.destroy();
    } catch {
      /* ignore */
    }
    try {
      lib?.destroy();
    } catch {
      /* ignore */
    }
  }
}

export async function rasterizeAndCrop(
  pdfBuffer: Buffer,
  opts: RasterizeCropOptions
): Promise<RasterizeResult | null> {
  const many = await rasterizeAndCropMany(
    pdfBuffer,
    opts.pageIndex,
    [opts.bbox],
    { scale: opts.scale, paddingPt: opts.paddingPt }
  );
  return many ? many[0] : null;
}

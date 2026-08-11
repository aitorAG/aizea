import { PDFService, PDFImage } from "@/lib/domain/pdf/PDFService";
import { compressToWebP } from "@/lib/domain/utils/image-compressor";
import type { IFigureStore } from "@/lib/application/ports/figure-store.port";
import type { IFigureRasterizer } from "@/lib/application/ports/figure-rasterizer.port";

export interface ExtractedFigure {
  id: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
}

export class FigureExtractor {
  private pdfService: PDFService;
  private readonly store: IFigureStore | undefined;
  private readonly rasterizer: IFigureRasterizer | undefined;

  constructor(
    pdfService?: PDFService,
    store?: IFigureStore,
    // v1.0 (Opción B) — rasterizador opcional para figuras con caption pero sin
    // imagen embebida (diagramas vectoriales). El composition root lo inyecta;
    // en tests se pasa un fake o se omite (comportamiento: se saltan).
    rasterizer?: IFigureRasterizer
  ) {
    this.pdfService = pdfService ?? new PDFService();
    // El almacén (FS + persistencia) se inyecta por el composition root; en
    // tests se pasa un store apuntando a un tempDir. Sustituye el antiguo
    // acoplamiento directo a `node:fs` + `@/lib/db`.
    this.store = store;
    this.rasterizer = rasterizer;
  }

  async extractAndSave(
    buffer: Buffer,
    courseId: string
  ): Promise<ExtractedFigure[]> {
    if (!this.store) {
      throw new Error(
        "FigureExtractor requiere un almacén inyectado (constructor store)."
      );
    }
    const store = this.store;
    const [figures, rawImages] = await Promise.all([
      this.pdfService.extractFigures(buffer),
      this.pdfService.extractImages(buffer).catch(() => [] as PDFImage[]),
    ]);

    // Compress large embedded images once so the disk write is cheap.
    const images: PDFImage[] = await Promise.all(
      rawImages.map(async (img) => ({
        ...img,
        data: await compressToWebP(img.data),
      }))
    );

    // Build a map of pageNum → images for matching.
    const imagesByPage = new Map<number, PDFImage[]>();
    for (const img of images) {
      const list = imagesByPage.get(img.pageNum) ?? [];
      list.push(img);
      imagesByPage.set(img.pageNum, list);
    }

    // Pass 1 — decide each figure's image source. A figure backed by a real
    // embedded raster on its page consumes one; the rest are queued for
    // rasterisation, grouped by page so we can cluster distinct figures and
    // render each page only once.
    interface Pending {
      index: number;
      caption: string | null;
      pageNum: number | null;
      embedded: Buffer | null;
    }
    const pending: Pending[] = [];
    const rasterQueueByPage = new Map<number, number[]>(); // pageNum → pending idx[]

    for (let i = 0; i < figures.length; i++) {
      const figure = figures[i];
      const pageImages =
        figure.pageNum != null ? imagesByPage.get(figure.pageNum) ?? [] : [];

      let embedded: Buffer | null = null;
      if (pageImages.length > 0) {
        embedded = pageImages[0].data;
        pageImages.shift();
      }

      const p: Pending = {
        index: i,
        caption: figure.caption,
        pageNum: figure.pageNum,
        embedded,
      };
      const pendingIdx = pending.push(p) - 1;

      // Queue for rasterisation only when there is no embedded image AND we can
      // rasterise (rasterizer present + known page).
      if (!embedded && this.rasterizer && figure.pageNum != null) {
        const list = rasterQueueByPage.get(figure.pageNum) ?? [];
        list.push(pendingIdx);
        rasterQueueByPage.set(figure.pageNum, list);
      }
    }

    // Pass 2 — rasterise per page (one render per page; clusters = caption
    // count) and hand the crops back to their pending entries in reading order.
    const rasterByPending = new Map<number, Buffer>();
    if (this.rasterizer) {
      for (const [pageNum, pendingIdxs] of rasterQueueByPage) {
        const crops = await this.rasterizer
          .rasterizeFigures(buffer, pageNum, pendingIdxs.length)
          .catch(() => [] as Awaited<ReturnType<IFigureRasterizer["rasterizeFigures"]>>);
        // Assign crops to captions in order; extra captions get no image.
        for (let k = 0; k < pendingIdxs.length && k < crops.length; k++) {
          const compressed = await compressToWebP(crops[k].png);
          rasterByPending.set(pendingIdxs[k], compressed);
        }
      }
    }

    // Pass 3 — persist every figure that ended up with an image, preserving the
    // original figure order.
    const results: ExtractedFigure[] = [];
    for (let pi = 0; pi < pending.length; pi++) {
      const p = pending[pi];
      const imageData = p.embedded ?? rasterByPending.get(pi) ?? null;

      // No real image and no rasterised crop → skip (no 1×1 placeholder), so
      // downstream "one slide per visual" never emits empty placeholder slides.
      if (!imageData) continue;

      const filename = this.generateFilename(courseId, p.index, p.caption ?? undefined);
      await store.writeImage(filename, imageData);

      const dbFigure = await store.createFigure({
        courseId,
        filename,
        caption: p.caption,
        pageNum: p.pageNum,
      });

      results.push({
        id: dbFigure.id,
        filename: dbFigure.filename,
        caption: dbFigure.caption,
        pageNum: dbFigure.pageNum,
      });
    }

    return results;
  }

  private generateFilename(
    courseId: string,
    index: number,
    caption?: string
  ): string {
    const safeCaption = caption
      ? caption
          .replace(/[^a-z0-9]/gi, "_")
          .replace(/_+/g, "_")
          .substring(0, 30)
      : "figure";
    return `fig_${courseId.substring(0, 8)}_${index}_${safeCaption}.png`;
  }
}

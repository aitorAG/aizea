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

    const results: ExtractedFigure[] = [];

    for (let i = 0; i < figures.length; i++) {
      const figure = figures[i];

      const pageImages = figure.pageNum != null
        ? imagesByPage.get(figure.pageNum) ?? []
        : [];

      const filename = this.generateFilename(courseId, i, figure.caption);
      let imageData: Buffer | null = null;

      if (pageImages.length > 0) {
        // Preferred: a real embedded raster image on the caption's page.
        imageData = pageImages[0].data;
        pageImages.shift();
      } else if (this.rasterizer && figure.pageNum != null) {
        // v1.0 (Opción B) — no embedded raster (vector diagram / composite).
        // Rasterise the figure region from the PDF and crop it, instead of
        // dropping the figure. Fully in-process (no docling). Degrades to
        // "skip" when the rasterizer can't produce a usable crop.
        const raster = await this.rasterizer
          .rasterizeFigure(buffer, figure.pageNum)
          .catch(() => null);
        if (raster) {
          imageData = await compressToWebP(raster.png);
        }
      }

      // No real image and no rasterised crop → skip (no 1×1 placeholder), so
      // downstream "one slide per visual" never emits empty placeholder slides.
      if (!imageData) {
        continue;
      }

      await store.writeImage(filename, imageData);

      const dbFigure = await store.createFigure({
        courseId,
        filename,
        caption: figure.caption,
        pageNum: figure.pageNum,
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

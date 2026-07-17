import { db } from "@/lib/db";
import { PDFService, PDFImage } from "@/lib/domain/pdf/PDFService";
import { compressToWebP } from "@/lib/domain/utils/image-compressor";
import fs from "node:fs/promises";
import path from "node:path";

export interface ExtractedFigure {
  id: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
}

export class FigureExtractor {
  private pdfService: PDFService;
  private figuresDir: string;

  constructor(pdfService?: PDFService, figuresDir?: string) {
    this.pdfService = pdfService ?? new PDFService();
    this.figuresDir = figuresDir ?? path.resolve(process.cwd(), "public", "figures");
  }

  async extractAndSave(
    buffer: Buffer,
    courseId: string
  ): Promise<ExtractedFigure[]> {
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
      const filename = this.generateFilename(courseId, i, figure.caption);

      const pageImages = figure.pageNum != null
        ? imagesByPage.get(figure.pageNum) ?? []
        : [];

      if (pageImages.length > 0) {
        const imageData = pageImages[0].data;
        await this.writeImageFile(filename, imageData);
        pageImages.shift();
      } else {
        // Fallback: tiny 1x1 transparent PNG. Real images are obtained when
        // the PDF has extractable XObject streams on the right page.
        const tinyPng = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          "base64"
        );
        await this.writeImageFile(filename, tinyPng);
      }

      const dbFigure = await db.figure.create({
        data: {
          courseId,
          filename,
          caption: figure.caption,
          pageNum: figure.pageNum,
        },
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

  private async writeImageFile(filename: string, data: Buffer): Promise<void> {
    const filePath = path.join(this.figuresDir, filename);
    await fs.mkdir(this.figuresDir, { recursive: true });
    await fs.writeFile(filePath, data);
  }
}

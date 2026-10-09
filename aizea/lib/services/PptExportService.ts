/**
 * PptExportService
 *
 * Generates PowerPoint presentations from slide data.
 * Each slide is rendered as a PNG image and placed in a PPT slide.
 */

import PptxGenJS from "pptxgenjs";
import { SlideImageRenderService } from "./SlideImageRenderService";

export interface SlideData {
  id: string;
  html: string;
}

export interface PptExportOptions {
  courseName?: string;
  imageWidth?: number;
  imageHeight?: number;
}

export class PptExportService {
  private imageRenderer: SlideImageRenderService;

  constructor() {
    this.imageRenderer = new SlideImageRenderService();
  }

  /**
   * Generate a PowerPoint presentation from an array of slides.
   *
   * @param slides - Array of slide data (id + HTML)
   * @param options - Export options (course name, image dimensions)
   * @returns Base64-encoded PPTX file
   */
  async generatePptFromSlides(
    slides: SlideData[],
    options: PptExportOptions = {}
  ): Promise<string> {
    const { courseName = "Curso", imageWidth = 10, imageHeight = 5.625 } = options;

    await this.imageRenderer.init();

    try {
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_16x9";
      pptx.author = "AIzea";
      pptx.title = courseName;

      for (const slide of slides) {
        const pngBuffer = await this.imageRenderer.renderSlideToPng(slide.html, {
          width: 1920,
          height: 1080,
          deviceScaleFactor: 2,
        });

        const base64Image = pngBuffer.toString("base64");
        const dataUrl = `data:image/png;base64,${base64Image}`;

        const pptSlide = pptx.addSlide();
        pptSlide.addImage({
          data: dataUrl,
          x: 0,
          y: 0,
          w: imageWidth,
          h: imageHeight,
        });
      }

      const pptxData = await pptx.write({ outputType: "base64" });
      return pptxData as string;
    } finally {
      await this.imageRenderer.close();
    }
  }
}

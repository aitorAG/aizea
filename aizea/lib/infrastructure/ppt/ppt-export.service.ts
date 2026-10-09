/**
 * PptExportService — genera presentaciones PowerPoint (.pptx) a partir de
 * slides de AIzea usando `pptxgenjs`.
 *
 * Estrategia: cada slide se renderiza a imagen PNG (1123×794) mediante
 * SlideImageRenderService (Playwright + auto-fit + KaTeX inline) y se coloca
 * como imagen full-bleed en una diapositiva PPT. Esto garantiza fidelidad
 * visual exacta respecto a la app (mismo HTML, mismo fit, mismo KaTeX).
 *
 * El PPTX generado es compatible con PowerPoint, Keynote, LibreOffice Impress
 * y Google Slides (vía import). El usuario puede luego exportar a PDF desde
 * PowerPoint si lo necesita, evitando el flakiness del PDF directo.
 */

import PptxGenJS from "pptxgenjs";
import { SlideImageRenderService } from "./slide-image-render.service";
import { buildSlideDocument } from "@/lib/actions/slide-export-helpers";

export interface PptSlide {
  /** Número jerárquico del slide (ej: "1.2.3") */
  numericPath: string;
  /** Título del slide */
  title: string;
  /** HTML design del slide (generado por el LLM) */
  htmlDesign: string;
}

export interface PptExportOptions {
  /** Nombre del curso (aparece en el título de la presentación) */
  courseName: string;
  /** Slides a exportar, ya ordenados por numericPath */
  slides: PptSlide[];
  /** Timeout de auto-fit por slide (default 6000ms) */
  fitTimeoutMs?: number;
}

export class PptExportService {
  private readonly imageRenderer = new SlideImageRenderService();

  /**
   * Genera un archivo PPTX a partir de los slides de un curso.
   *
   * @param options opciones de exportación
   * @returns Buffer con el archivo .pptx
   */
  async generatePptx(options: PptExportOptions): Promise<Buffer> {
    const { courseName, slides, fitTimeoutMs = 6000 } = options;

    // 1. Renderizar todos los slides a imágenes PNG (batch para eficiencia)
    const htmlDocs = slides.map((slide) =>
      buildSlideDocument({
        htmlDesign: slide.htmlDesign,
        title: `${slide.numericPath} - ${slide.title}`,
      })
    );
    const imageBuffers = await this.imageRenderer.renderMultipleToImages(
      htmlDocs,
      fitTimeoutMs
    );

    // 2. Crear presentación PPT
    const pptx = new PptxGenJS();
    pptx.author = "AIzea";
    pptx.company = "AIzea";
    pptx.subject = courseName;
    pptx.title = courseName;

    // Configurar tamaño de slide A4 landscape (mismo que el HTML: 1123×794 @ 96dpi)
    // PptxGenJS usa pulgadas, así que convertimos: 1123px / 96dpi = 11.70", 794px / 96dpi = 8.27"
    pptx.layout = "LAYOUT_WIDE"; // 13.33" × 7.5" (más cercano a 16:9)
    // Como no hay un layout exacto 1123×794, usamos LAYOUT_WIDE y centramos las imágenes

    // 3. Agregar cada slide como imagen full-bleed
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i];
      const imageBuffer = imageBuffers[i];

      const pptSlide = pptx.addSlide();

      // Agregar título como texto (opcional, para accesibilidad)
      pptSlide.addText(`${slide.numericPath} - ${slide.title}`, {
        x: 0.5,
        y: 0.2,
        w: 12.33,
        h: 0.5,
        fontSize: 24,
        bold: true,
        color: "363636",
        fontFace: "Inter",
      });

      // Agregar imagen del slide (centrada, manteniendo aspect ratio)
      // 1123×794 @ 96dpi = 11.70" × 8.27"
      // LAYOUT_WIDE = 13.33" × 7.5"
      // Para que la imagen quepa sin distorsión, escalamos proporcionalmentE
      const slideWidthInches = 1123 / 96; // 11.70"
      const slideHeightInches = 794 / 96; // 8.27"
      const layoutWidth = 13.33;
      const layoutHeight = 7.5;

      // Calcular escala para que quepa dentro del layout sin distorsión
      const scaleW = layoutWidth / slideWidthInches;
      const scaleH = layoutHeight / slideHeightInches;
      const scale = Math.min(scaleW, scaleH);

      const finalW = slideWidthInches * scale;
      const finalH = slideHeightInches * scale;
      const x = (layoutWidth - finalW) / 2;
      const y = (layoutHeight - finalH) / 2 + 0.8; // +0.8" para dejar espacio al título

      pptSlide.addImage({
        data: `data:image/png;base64,${imageBuffer.toString("base64")}`,
        x,
        y: y,
        w: finalW,
        h: finalH,
      });
    }

    // 4. Exportar a Buffer
    // pptxgenjs.write() devuelve Promise<string | ArrayBuffer | Buffer>
    // En Node, devuelve un Buffer directamente con el output type "nodebuffer"
    const output = await pptx.write({ outputType: "nodebuffer" });
    
    // Aseguramos que sea un Buffer (puede venir como ArrayBuffer en algunos casos)
    if (Buffer.isBuffer(output)) {
      return output;
    } else if (output instanceof ArrayBuffer) {
      return Buffer.from(output);
    } else {
      throw new Error("Formato de salida inesperado de pptxgenjs");
    }
  }
}

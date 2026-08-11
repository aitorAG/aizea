// Puerto de rasterizado de figuras que necesita FigureExtractor (v1.0, Opción B).
//
// Cuando una figura tiene caption pero NO imagen embebida extraíble (diagramas
// vectoriales / compuestos), este puerto rasteriza la región de la figura desde
// el PDF y devuelve un PNG. Mantiene `FigureExtractor` (dominio) libre de
// dependencias de infraestructura (pdf-lib, pdfium, pngjs). La implementación
// vive en `lib/infrastructure/pdf/figure-rasterizer.ts`.

export interface RasterizedFigure {
  /** Bytes PNG del recorte de la figura. */
  png: Buffer;
  width: number;
  height: number;
}

export interface IFigureRasterizer {
  /**
   * Rasteriza y recorta la figura de la página `pageNum` (1-based) del PDF.
   * Devuelve null cuando no hay geometría de dibujo utilizable, el motor no está
   * disponible, o el recorte resultante es degenerado — el llamador degrada
   * saltándose la figura (sin placeholder).
   */
  rasterizeFigure(
    pdfBuffer: Buffer,
    pageNum: number
  ): Promise<RasterizedFigure | null>;
}

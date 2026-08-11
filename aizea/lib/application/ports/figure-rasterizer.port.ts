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
   * Rasteriza y recorta las figuras de la página `pageNum` (1-based) del PDF.
   *
   * `expectedCount` es el número de captions "Figura N" detectados en esa
   * página que aún no tienen imagen embebida. Cuando es 1, se devuelve un único
   * recorte con TODA la geometría de dibujo de la página (robusto ante figuras
   * fragmentadas). Cuando es ≥2, la geometría se agrupa en clústeres espaciales
   * (figuras distintas) y se devuelve un recorte por clúster, en orden de
   * lectura (arriba→abajo, izquierda→derecha), como máximo `expectedCount`.
   *
   * Devuelve [] cuando no hay geometría utilizable, el motor no está disponible,
   * o todos los recortes salen degenerados — el llamador degrada saltándose las
   * figuras sin recorte (sin placeholder).
   */
  rasterizeFigures(
    pdfBuffer: Buffer,
    pageNum: number,
    expectedCount: number
  ): Promise<RasterizedFigure[]>;
}

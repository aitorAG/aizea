// Puerto de almacenamiento de figuras que necesita FigureExtractor.
//
// FigureExtractor (dominio) orquestaba DOS concerns de infraestructura:
//   1. escritura del fichero de imagen en disco (`node:fs` + `@/lib/paths`)
//   2. persistencia de la fila Figure (`@/lib/db`)
// Este puerto los encapsula para que `FigureExtractor` NO importe ni Prisma ni
// el sistema de ficheros (gate de Fase 1: cero imports de infra en domain/).
// La implementación vive en `lib/infrastructure/figures/figure-store.ts`.

/** Datos para persistir una figura. */
export interface FigureToSave {
  courseId: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
}

/** Fila de figura devuelta tras persistir. */
export interface SavedFigure {
  id: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
}

export interface IFigureStore {
  /** Escribe los bytes de la imagen bajo `filename` en el almac�n de figuras. */
  writeImage(filename: string, data: Buffer): Promise<void>;

  /** Lee los bytes de la imagen `filename`, o null si no existe. v1.0: se usa
   *  para embeber la figura como data URI en la diapositiva-figura. */
  readImage(filename: string): Promise<Buffer | null>;

  /** Persiste la fila Figure y devuelve su identidad. */
  createFigure(data: FigureToSave): Promise<SavedFigure>;
}

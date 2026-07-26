// Puerto del repositorio que necesita UnitExtractor.
//
// Encapsula las 3 operaciones Prisma que el servicio de dominio usa al extraer
// la representación de una SemanticUnit (upsert idempotente de la
// UnitRepresentation, resolución del courseId vía Material, y búsqueda de
// figuras por rango de páginas), para que `UnitExtractor` NO importe Prisma
// (`@/lib/db`) directamente (gate de Fase 1: cero imports de infra en
// domain/). La implementación Prisma vive en
// `lib/infrastructure/persistence/prisma-unit-extractor.repository.ts`.

/** Payload JSON-codificado de una UnitRepresentation (todos los campos son
 *  arrays serializados con JSON.stringify por el servicio). */
export interface UnitRepresentationData {
  concepts: string;
  mainIdeas: string;
  formulas: string;
  figures: string;
  prerequisites: string;
  introduces: string;
}

/** Fila mínima de UnitRepresentation devuelta tras el upsert. */
export interface UpsertedRepresentationRow {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Fila de figura tal como la consume UnitExtractor. */
export interface FigureRowForUnit {
  id: string;
  filename: string;
  pageNum: number | null;
  caption: string | null;
  tags: string | null;
}

export interface IUnitExtractorRepository {
  /** Upsert idempotente de la UnitRepresentation, keyed por unitId. */
  upsertRepresentation(
    unitId: string,
    data: UnitRepresentationData
  ): Promise<UpsertedRepresentationRow>;

  /** courseId del material, o null si no existe (para acotar figuras). */
  findCourseIdByMaterial(materialId: string): Promise<string | null>;

  /** Figuras del curso dentro del rango de páginas [pageStart, pageEnd]. */
  findFiguresByPageRange(
    courseId: string,
    pageStart: number,
    pageEnd: number
  ): Promise<FigureRowForUnit[]>;
}

// Puerto del repositorio que necesita SegmenterService (rama de persistencia).
//
// Encapsula las 2 operaciones Prisma que el servicio de dominio usa al
// persistir SemanticUnits, para que `SegmenterService` NO importe Prisma
// (`@/lib/db`) directamente (gate de Fase 1: cero imports de infra en
// domain/). La implementación Prisma vive en
// `lib/infrastructure/persistence/prisma-segmenter.repository.ts`.

/** Datos para crear una SemanticUnit. */
export interface CreateSemanticUnitInput {
  materialId: string;
  content: string;
  order: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionRef: string | null;
}

/** Fila de SemanticUnit devuelta tras persistir (ordenada por `order`). */
export interface SegmenterUnitRow {
  id: string;
  content: string;
  order: number;
  pageStart: number | null;
  pageEnd: number | null;
  sectionRef: string | null;
  createdAt: Date;
}

export interface ISegmenterRepository {
  /** Crea N SemanticUnits en un solo round-trip (createMany). */
  createUnits(units: CreateSemanticUnitInput[]): Promise<void>;

  /** Devuelve las SemanticUnits del material, ordenadas por `order` asc. */
  findUnitsByMaterialOrdered(materialId: string): Promise<SegmenterUnitRow[]>;
}

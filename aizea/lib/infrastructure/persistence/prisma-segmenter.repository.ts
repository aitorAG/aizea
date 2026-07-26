// PrismaSegmenterRepository — implementación Prisma de `ISegmenterRepository`.
//
// Único lugar que conoce la forma Prisma de las 2 operaciones que
// SegmenterService necesita al persistir. Extraído en la Fase 1 (purificación
// del dominio) para que `SegmenterService` no importe `@/lib/db`.

import { db } from "@/lib/db";
import type {
  CreateSemanticUnitInput,
  ISegmenterRepository,
  SegmenterUnitRow,
} from "@/lib/application/ports/segmenter-repository.port";

export class PrismaSegmenterRepository implements ISegmenterRepository {
  async createUnits(units: CreateSemanticUnitInput[]): Promise<void> {
    await db.semanticUnit.createMany({ data: units });
  }

  async findUnitsByMaterialOrdered(
    materialId: string
  ): Promise<SegmenterUnitRow[]> {
    const rows = await db.semanticUnit.findMany({
      where: { materialId },
      orderBy: { order: "asc" },
      select: {
        id: true,
        content: true,
        order: true,
        pageStart: true,
        pageEnd: true,
        sectionRef: true,
        createdAt: true,
      },
    });
    return rows;
  }
}

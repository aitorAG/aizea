// PrismaUnitExtractorRepository — implementación Prisma de
// `IUnitExtractorRepository`.
//
// Único lugar que conoce la forma Prisma de las 3 operaciones que
// UnitExtractor necesita. Extraído en la Fase 1 (purificación del dominio)
// para que `UnitExtractor` no importe `@/lib/db`.

import { db } from "@/lib/db";
import type {
  FigureRowForUnit,
  IUnitExtractorRepository,
  UnitRepresentationData,
  UpsertedRepresentationRow,
} from "@/lib/application/ports/unit-extractor-repository.port";

export class PrismaUnitExtractorRepository
  implements IUnitExtractorRepository
{
  async upsertRepresentation(
    unitId: string,
    data: UnitRepresentationData
  ): Promise<UpsertedRepresentationRow> {
    const row = await db.unitRepresentation.upsert({
      where: { unitId },
      create: { unitId, ...data },
      update: data,
    });
    return { id: row.id, createdAt: row.createdAt, updatedAt: row.updatedAt };
  }

  async findCourseIdByMaterial(materialId: string): Promise<string | null> {
    const material = await db.material.findUnique({
      where: { id: materialId },
      select: { courseId: true },
    });
    return material?.courseId ?? null;
  }

  async findFiguresByPageRange(
    courseId: string,
    pageStart: number,
    pageEnd: number
  ): Promise<FigureRowForUnit[]> {
    const rows = await db.figure.findMany({
      where: {
        courseId, // CRITICAL: scope to this course only (cross-course leak fix)
        pageNum: { gte: pageStart, lte: pageEnd },
      },
      select: {
        id: true,
        filename: true,
        pageNum: true,
        caption: true,
        tags: true,
      },
    });
    return rows;
  }
}

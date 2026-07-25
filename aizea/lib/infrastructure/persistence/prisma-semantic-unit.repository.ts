// PrismaSemanticUnitRepository — concrete implementation of ISemanticUnitRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ISemanticUnitRepository, SemanticUnitRow } from "@/lib/application/ports/semantic-unit-repository.port";

export class PrismaSemanticUnitRepository implements ISemanticUnitRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findByMaterialId(materialId: string): Promise<SemanticUnitRow[]> {
    return this.prisma.semanticUnit.findMany({
      where: { materialId },
      orderBy: { order: "asc" },
    }) as Promise<SemanticUnitRow[]>;
  }

  async findById(id: string): Promise<SemanticUnitRow | null> {
    return this.prisma.semanticUnit.findUnique({ where: { id } }) as Promise<SemanticUnitRow | null>;
  }

  async createMany(units: Omit<SemanticUnitRow, "id" | "createdAt">[]): Promise<void> {
    await this.prisma.semanticUnit.createMany({ data: units });
  }

  async hasUnitsForMaterial(materialId: string): Promise<boolean> {
    const count = await this.prisma.semanticUnit.count({ where: { materialId } });
    return count > 0;
  }
}

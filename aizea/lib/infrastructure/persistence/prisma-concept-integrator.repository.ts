// PrismaConceptIntegratorRepository — implementación Prisma de
// `IConceptIntegratorRepository`.
//
// Es el único lugar que conoce la forma Prisma de las 3 consultas que
// ConceptIntegrator necesita. Extraído en la Fase 1 (purificación del dominio)
// para que `ConceptIntegrator` no importe `@/lib/db`.

import { db } from "@/lib/db";
import type {
  ConceptRepresentationRow,
  CreatedTopicGroupRow,
  CreateTopicGroupInput,
  IConceptIntegratorRepository,
} from "@/lib/application/ports/concept-integrator-repository.port";

export class PrismaConceptIntegratorRepository
  implements IConceptIntegratorRepository
{
  async findUnitIdsByCourse(courseId: string): Promise<string[]> {
    const units = await db.semanticUnit.findMany({
      where: { material: { courseId } },
      select: { id: true },
    });
    return units.map((u) => u.id);
  }

  async findRepresentationsByUnitIds(
    unitIds: string[]
  ): Promise<ConceptRepresentationRow[]> {
    const rows = await db.unitRepresentation.findMany({
      where: { unitId: { in: unitIds } },
      select: { unitId: true, concepts: true },
    });
    return rows.map((r) => ({ unitId: r.unitId, concepts: r.concepts }));
  }

  async createTopicGroup(
    data: CreateTopicGroupInput
  ): Promise<CreatedTopicGroupRow> {
    const row = await db.topicGroup.create({ data });
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      importance: row.importance,
    };
  }
}

// PrismaTreeBuilderRepository — implementación Prisma de
// `ITreeBuilderRepository`.
//
// Único lugar que conoce la forma Prisma de las 4 consultas que TreeBuilder
// necesita. Extraído en la Fase 1 (purificación del dominio) para que
// `TreeBuilder` no importe `@/lib/db`.

import { db } from "@/lib/db";
import type {
  CreatedTopicNodeRow,
  CreateTopicNodeInput,
  ITreeBuilderRepository,
  TreeBuilderGroupRow,
} from "@/lib/application/ports/tree-builder-repository.port";

export class PrismaTreeBuilderRepository implements ITreeBuilderRepository {
  async findTopicGroupsByCourse(
    courseId: string
  ): Promise<TreeBuilderGroupRow[]> {
    const rows = await db.topicGroup.findMany({ where: { courseId } });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      importance: r.importance,
      concepts: r.concepts,
      sourceUnitIds: r.sourceUnitIds,
    }));
  }

  async findLatestVersion(courseId: string): Promise<number | null> {
    const previous = await db.topicNode.findFirst({
      where: { courseId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return previous?.version ?? null;
  }

  async deleteNodesByCourse(courseId: string): Promise<void> {
    await db.topicNode.deleteMany({ where: { courseId } });
  }

  async createNode(data: CreateTopicNodeInput): Promise<CreatedTopicNodeRow> {
    return db.topicNode.create({ data });
  }
}

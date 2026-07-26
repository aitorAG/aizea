// PrismaTreeBuilderRepository — implementación Prisma de
// `ITreeBuilderRepository`.
//
// Único lugar que conoce la forma Prisma de las 4 consultas que TreeBuilder
// necesita. Extraído en la Fase 1 (purificación del dominio) para que
// `TreeBuilder` no importe `@/lib/db`.

import { db } from "@/lib/db";
import type {
  BatchTopicNodeInput,
  CreatedTopicNodeRow,
  CreateTopicNodeInput,
  ITreeBuilderRepository,
  TreeBuilderGroupRow,
  UnitSectionPathRow,
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

  async findSectionPathsByUnitIds(
    unitIds: string[]
  ): Promise<UnitSectionPathRow[]> {
    if (unitIds.length === 0) return [];
    const rows = await db.semanticUnit.findMany({
      where: { id: { in: unitIds } },
      select: { id: true, sectionPath: true },
    });
    return rows.map((r) => ({ unitId: r.id, sectionPath: r.sectionPath }));
  }

  async replaceCourseNodes(
    courseId: string,
    nodes: BatchTopicNodeInput[]
  ): Promise<CreatedTopicNodeRow[]> {
    // Atomic build-before-delete: delete + topological insert in ONE
    // transaction. If any insert fails, the whole thing rolls back and the
    // previous tree stays intact (fixes P4: never leave the course tree-less).
    return db.$transaction(async (tx) => {
      await tx.topicNode.deleteMany({ where: { courseId } });
      const refToId = new Map<string, string>();
      const created: CreatedTopicNodeRow[] = [];
      // `nodes` is topologically ordered (parents before children), so each
      // parentTempRef is already resolved by the time we reach a child.
      for (const n of nodes) {
        const parentId =
          n.parentTempRef !== null
            ? refToId.get(n.parentTempRef) ?? null
            : null;
        const row = await tx.topicNode.create({
          data: {
            courseId,
            parentId,
            name: n.name,
            summary: n.summary,
            depth: n.depth,
            isLeaf: n.isLeaf,
            version: n.version,
            sourceMaterialId: n.sourceMaterialId,
          },
        });
        refToId.set(n.tempRef, row.id);
        created.push(row);
      }
      return created;
    });
  }
}

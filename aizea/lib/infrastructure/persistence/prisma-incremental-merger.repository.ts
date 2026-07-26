// PrismaIncrementalMergerRepository — implementación Prisma de
// `IIncrementalMergerRepository`.
//
// Único lugar que conoce la forma Prisma de las 3 operaciones que
// IncrementalMerger necesita al mezclar una material nueva en el árbol.
// Extraído en la Fase 1 (purificación del dominio) para que
// `IncrementalMerger` no importe `@/lib/db`.

import { db } from "@/lib/db";
import type {
  IIncrementalMergerRepository,
  MergeCreateNodeInput,
  MergeTopicNodeRow,
} from "@/lib/application/ports/incremental-merger-repository.port";

export class PrismaIncrementalMergerRepository
  implements IIncrementalMergerRepository
{
  async findNodesByCourse(courseId: string): Promise<MergeTopicNodeRow[]> {
    return db.topicNode.findMany({ where: { courseId } });
  }

  async findLatestVersion(courseId: string): Promise<number | null> {
    const previous = await db.topicNode.findFirst({
      where: { courseId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return previous?.version ?? null;
  }

  async createNode(data: MergeCreateNodeInput): Promise<MergeTopicNodeRow> {
    return db.topicNode.create({ data });
  }
}

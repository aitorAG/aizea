// PrismaRagRepository — implementación Prisma de `IRagRepository`.
//
// Único lugar que conoce la forma Prisma de las operaciones que RAGEngine usa
// al indexar (leer contenido del material + reemplazo atómico de TextChunks).
// Extraído en la Fase 1 (purificación del dominio) para que `RAGEngine` no
// importe `@/lib/db`.

import { db } from "@/lib/db";
import type {
  IRagRepository,
  TextChunkInput,
} from "@/lib/application/ports/rag-repository.port";

export class PrismaRagRepository implements IRagRepository {
  async findMaterialContent(materialId: string): Promise<string | null> {
    const material = await db.material.findUnique({
      where: { id: materialId },
      select: { content: true },
    });
    return material?.content ?? null;
  }

  async replaceChunks(
    materialId: string,
    chunks: TextChunkInput[]
  ): Promise<void> {
    // DB-first: clear old chunks and write new ones atomically.
    await db.$transaction([
      db.textChunk.deleteMany({ where: { materialId } }),
      db.textChunk.createMany({ data: chunks }),
    ]);
  }
}

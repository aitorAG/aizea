// PrismaTextChunkRepository — concrete implementation of ITextChunkRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ITextChunkRepository, TextChunkRow } from "@/lib/application/ports/text-chunk-repository.port";

export class PrismaTextChunkRepository implements ITextChunkRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findByMaterialId(materialId: string): Promise<TextChunkRow[]> {
    return this.prisma.textChunk.findMany({
      where: { materialId },
      orderBy: { chunkIndex: "asc" },
    }) as Promise<TextChunkRow[]>;
  }

  async createMany(chunks: Omit<TextChunkRow, "id">[]): Promise<void> {
    await this.prisma.textChunk.createMany({ data: chunks });
  }

  async deleteByMaterialId(materialId: string): Promise<void> {
    await this.prisma.textChunk.deleteMany({ where: { materialId } });
  }

  async replaceForMaterial(materialId: string, chunks: Omit<TextChunkRow, "id">[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.textChunk.deleteMany({ where: { materialId } }),
      this.prisma.textChunk.createMany({ data: chunks }),
    ]);
  }
}

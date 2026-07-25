// PrismaSlideBoxRepository — concrete implementation of ISlideBoxRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ISlideBoxRepository, SlideBoxRow } from "@/lib/application/ports/slide-box-repository.port";

export class PrismaSlideBoxRepository implements ISlideBoxRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findBySlideId(slideId: string): Promise<SlideBoxRow[]> {
    return this.prisma.slideBox.findMany({ where: { slideId } });
  }

  async update(id: string, content: string): Promise<SlideBoxRow> {
    return this.prisma.slideBox.update({ where: { id }, data: { content } });
  }

  async replaceForSlide(
    slideId: string,
    boxes: { type: string; content: string }[]
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.slideBox.deleteMany({ where: { slideId } }),
      this.prisma.slideBox.createMany({
        data: boxes.map((b) => ({ slideId, type: b.type, content: b.content })),
      }),
    ]);
  }
}

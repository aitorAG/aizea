// PrismaSlideRepository — concrete implementation of ISlideRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ISlideRepository, SlideRow } from "@/lib/application/ports/slide-repository.port";

export class PrismaSlideRepository implements ISlideRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findById(id: string): Promise<SlideRow | null> {
    return this.prisma.slide.findUnique({ where: { id } }) as Promise<SlideRow | null>;
  }

  async findCourseIdById(id: string): Promise<{ courseId: string } | null> {
    return this.prisma.slide.findUnique({ where: { id }, select: { courseId: true } });
  }

  async findByCourseId(courseId: string): Promise<SlideRow[]> {
    return this.prisma.slide.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
    }) as Promise<SlideRow[]>;
  }

  async create(data: Omit<SlideRow, "createdAt" | "updatedAt">): Promise<SlideRow> {
    return this.prisma.slide.create({ data }) as Promise<SlideRow>;
  }

  async update(id: string, data: Partial<SlideRow>): Promise<SlideRow> {
    return this.prisma.slide.update({ where: { id }, data }) as Promise<SlideRow>;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.slide.delete({ where: { id } });
  }

  async deleteByCourseId(courseId: string): Promise<void> {
    await this.prisma.slide.deleteMany({ where: { courseId } });
  }

  async maxOrderByCourseId(courseId: string): Promise<number> {
    const result = await this.prisma.slide.aggregate({
      where: { courseId },
      _max: { order: true },
    });
    return result._max.order ?? -1;
  }
}

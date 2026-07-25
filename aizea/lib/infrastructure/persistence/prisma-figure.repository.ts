// PrismaFigureRepository — concrete implementation of IFigureRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { IFigureRepository, FigureRow } from "@/lib/application/ports/figure-repository.port";

export class PrismaFigureRepository implements IFigureRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findByCourseId(courseId: string): Promise<FigureRow[]> {
    return this.prisma.figure.findMany({
      where: { courseId },
      orderBy: { createdAt: "desc" },
    }) as Promise<FigureRow[]>;
  }

  async findByPageRange(courseId: string, pageStart: number, pageEnd: number): Promise<FigureRow[]> {
    return this.prisma.figure.findMany({
      where: {
        courseId, // CRITICAL: prevents cross-course figure leaks
        pageNum: { gte: pageStart, lte: pageEnd },
      },
    }) as Promise<FigureRow[]>;
  }

  async create(data: Omit<FigureRow, "id" | "createdAt">): Promise<FigureRow> {
    return this.prisma.figure.create({ data }) as Promise<FigureRow>;
  }

  async update(id: string, data: Partial<FigureRow>): Promise<FigureRow> {
    return this.prisma.figure.update({ where: { id }, data }) as Promise<FigureRow>;
  }

  async replaceAllForCourse(
    courseId: string,
    figures: Omit<FigureRow, "id" | "createdAt">[]
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.figure.deleteMany({ where: { courseId } }),
      this.prisma.figure.createMany({ data: figures }),
    ]);
  }
}

// PrismaCourseRepository — concrete implementation of ICourseRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ICourseRepository, CourseSummary } from "@/lib/application/ports/course-repository.port";

export class PrismaCourseRepository implements ICourseRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findAll(): Promise<CourseSummary[]> {
    const rows = await this.prisma.course.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { slides: true, materials: true, figures: true },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      llmContext: r.llmContext,
      slideCount: r._count.slides,
      materialCount: r._count.materials,
      figureCount: r._count.figures,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async findById(id: string) {
    const row = await this.prisma.course.findUnique({
      where: { id },
      select: { id: true, name: true, llmContext: true },
    });
    return row ?? null;
  }

  async create(input: { name: string; llmContext?: string }) {
    const row = await this.prisma.course.create({
      data: { name: input.name, llmContext: input.llmContext ?? "" },
      select: { id: true },
    });
    return { id: row.id };
  }

  async update(id: string, data: { name?: string; llmContext?: string | null }) {
    await this.prisma.course.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.prisma.course.delete({ where: { id } });
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.prisma.course.count({ where: { id } });
    return count > 0;
  }
}

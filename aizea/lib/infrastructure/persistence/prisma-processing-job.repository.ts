// PrismaProcessingJobRepository — concrete implementation of IProcessingJobRepository.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type {
  IProcessingJobRepository,
  ProcessingJobRow,
  ProcessingJobWithCourseName,
} from "@/lib/application/ports/processing-job-repository.port";

export class PrismaProcessingJobRepository implements IProcessingJobRepository {
  constructor(private readonly prisma: PrismaClient = db) {}

  async findById(id: string): Promise<ProcessingJobRow | null> {
    return this.prisma.processingJob.findUnique({ where: { id } }) as Promise<ProcessingJobRow | null>;
  }

  async create(data: Omit<ProcessingJobRow, "createdAt" | "updatedAt">): Promise<ProcessingJobRow> {
    return this.prisma.processingJob.create({ data }) as Promise<ProcessingJobRow>;
  }

  async update(id: string, data: Partial<ProcessingJobRow>): Promise<ProcessingJobRow> {
    return this.prisma.processingJob.update({ where: { id }, data }) as Promise<ProcessingJobRow>;
  }

  async findRecentWithCourseNames(options: {
    windowMs: number;
    courseId?: string;
    statusFilter?: string[];
    terminalStatuses?: string[];
  }): Promise<ProcessingJobWithCourseName[]> {
    const cutoff = new Date(Date.now() - options.windowMs);

    const orFilters = options.statusFilter
      ? options.statusFilter.map((s) => ({ status: s }))
      : options.terminalStatuses
        ? [
            { status: { in: ["pending", "running"] as string[] } },
            ...options.terminalStatuses.map((s) => ({
              status: s,
              updatedAt: { gte: cutoff },
            })),
          ]
        : [{ status: { in: ["pending", "running"] as string[] } }];

    const rows = await this.prisma.processingJob.findMany({
      where: {
        ...(options.courseId ? { courseId: options.courseId } : {}),
        OR: orFilters,
      },
      orderBy: { updatedAt: "desc" },
      include: { course: { select: { name: true } } },
    });

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      progress: row.progress,
      total: row.total,
      currentStep: row.currentStep,
      error: row.error,
      courseId: row.courseId,
      materialId: row.materialId,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      courseName: row.course?.name ?? null,
    }));
  }
}

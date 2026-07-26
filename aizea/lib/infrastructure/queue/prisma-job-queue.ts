// PrismaJobQueue — implementación de IJobQueue sobre `ProcessingJob`.
//
// La fila meta del run usa `type="pipeline-run"`. Las filas de fase
// (segmentation/extraction/…) las crea el propio PipelineService y NO las
// gestiona esta cola. El banner excluye `type="pipeline-run"` para no
// mostrar la fila meta como si fuera una fase.

import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import type { ProcessingStatus } from "@/lib/types/pipeline";
import {
  type EnqueueRunInput,
  type IJobQueue,
  type PipelineRun,
  PIPELINE_RUN_TYPE,
} from "@/lib/application/ports/job-queue.port";

interface ProcessingJobRowShape {
  id: string;
  status: string;
  courseId: string | null;
  materialId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toRun(row: ProcessingJobRowShape): PipelineRun {
  return {
    runId: row.id,
    courseId: row.courseId,
    materialId: row.materialId,
    status: row.status as ProcessingStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaJobQueue implements IJobQueue {
  constructor(private readonly prisma: PrismaClient = db) {}

  async enqueue(input: EnqueueRunInput): Promise<PipelineRun> {
    const id = `run-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const row = await this.prisma.processingJob.create({
      data: {
        id,
        type: PIPELINE_RUN_TYPE,
        status: "pending",
        progress: 0,
        total: 100,
        currentStep: "En cola",
        courseId: input.courseId,
        materialId: input.materialId ?? null,
      },
    });
    return toRun(row);
  }

  async claimNext(): Promise<PipelineRun | null> {
    // Worker único in-process: leer el pendiente más antiguo y marcarlo
    // running. No hay carrera entre reclamos concurrentes.
    const next = await this.prisma.processingJob.findFirst({
      where: { type: PIPELINE_RUN_TYPE, status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    if (!next) return null;
    const updated = await this.prisma.processingJob.update({
      where: { id: next.id },
      data: { status: "running", currentStep: "Procesando" },
    });
    return toRun(updated);
  }

  async findRun(runId: string): Promise<PipelineRun | null> {
    const row = await this.prisma.processingJob.findUnique({
      where: { id: runId },
    });
    if (!row || row.type !== PIPELINE_RUN_TYPE) return null;
    return toRun(row);
  }

  async markCompleted(runId: string): Promise<void> {
    await this.prisma.processingJob.update({
      where: { id: runId },
      data: { status: "completed", progress: 100, currentStep: "Completado" },
    });
  }

  async markFailed(runId: string, error: string): Promise<void> {
    await this.prisma.processingJob.update({
      where: { id: runId },
      data: { status: "failed", error, currentStep: "Fallido" },
    });
  }

  async markCancelled(runId: string): Promise<void> {
    // Idempotente en estados terminales: no re-cancelar un run ya terminado.
    const row = await this.prisma.processingJob.findUnique({
      where: { id: runId },
      select: { status: true, type: true },
    });
    if (!row || row.type !== PIPELINE_RUN_TYPE) return;
    if (row.status === "completed" || row.status === "failed" || row.status === "cancelled") {
      return;
    }
    await this.prisma.processingJob.update({
      where: { id: runId },
      data: { status: "cancelled", currentStep: "Cancelado" },
    });
  }

  async recoverStale(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await this.prisma.processingJob.updateMany({
      where: {
        type: PIPELINE_RUN_TYPE,
        status: "running",
        updatedAt: { lt: cutoff },
      },
      data: { status: "pending", currentStep: "Reanudando tras reinicio" },
    });
    return result.count;
  }
}

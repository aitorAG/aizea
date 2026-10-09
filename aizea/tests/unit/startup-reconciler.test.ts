// Tests del StartupReconciler (v0.14.0):
//   - jobs de fase running/pending → failed con mensaje de interrupción
//   - meta-runs pipeline-run running → pending (reanudables)
//   - slides en estados de generación → failed
//   - idempotencia: segunda pasada sin cambios
//   - filas ya terminales no se tocan

import { describe, it, expect, vi } from "vitest";
import { reconcileStartupState } from "@/lib/infrastructure/pipeline/startup-reconciler";

interface JobRow {
  id: string;
  type: string;
  status: string;
  error: string | null;
  currentStep: string | null;
}

interface SlideRow {
  id: string;
  status: string | null;
}

function createFakePrisma(jobs: JobRow[], slides: SlideRow[]) {
  /** Prisma acepta `status: "x"` o `status: { in: [...] }`. */
  function matches(value: string, condition: string | { in: string[] }): boolean {
    if (typeof condition === "string") return value === condition;
    return condition.in.includes(value);
  }
  return {
    processingJob: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            type: string | { in: string[] };
            status: string | { in: string[] };
          };
          data: { status: string; error?: string; currentStep?: string };
        }) => {
          let count = 0;
          for (const job of jobs) {
            if (
              matches(job.type, where.type) &&
              matches(job.status, where.status)
            ) {
              job.status = data.status;
              job.error = data.error ?? null;
              job.currentStep = data.currentStep ?? null;
              count++;
            }
          }
          return { count };
        }
      ),
    },
    slide: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { status: string | { in: string[] } };
          data: { status: string };
        }) => {
          let count = 0;
          for (const slide of slides) {
            if (slide.status && matches(slide.status, where.status)) {
              slide.status = data.status;
              count++;
            }
          }
          return { count };
        }
      ),
    },
  };
}

describe("reconcileStartupState", () => {
  it("marca jobs de fase huérfanos como failed con mensaje de interrupción", async () => {
    const jobs: JobRow[] = [
      { id: "j1", type: "extraction", status: "running", error: null, currentStep: null },
      { id: "j2", type: "segmentation", status: "pending", error: null, currentStep: null },
      { id: "j3", type: "integration", status: "completed", error: null, currentStep: null },
    ];
    const prisma = createFakePrisma(jobs, []);

    const result = await reconcileStartupState({ prisma: prisma as never });

    expect(result.failedPhaseJobs).toBe(2);
    const extraction = jobs.find((j) => j.id === "j1")!;
    expect(extraction.status).toBe("failed");
    expect(extraction.error).toMatch(/Interrumpido/i);
    // El job completado NO se toca.
    expect(jobs.find((j) => j.id === "j3")!.status).toBe("completed");
  });

  it("devuelve los meta-runs pipeline-run a pending para reanudación", async () => {
    const jobs: JobRow[] = [
      { id: "run1", type: "pipeline-run", status: "running", error: null, currentStep: null },
      { id: "run2", type: "pipeline-run", status: "completed", error: null, currentStep: null },
    ];
    const prisma = createFakePrisma(jobs, []);

    const result = await reconcileStartupState({ prisma: prisma as never });

    expect(result.resumedRuns).toBe(1);
    expect(jobs[0].status).toBe("pending");
    expect(jobs[0].currentStep).toMatch(/Reanudando/i);
    expect(jobs[1].status).toBe("completed");
  });

  it("resetea slides en generación zombie a failed y toca las demás", async () => {
    const slides: SlideRow[] = [
      { id: "s1", status: "generating_html" },
      { id: "s2", status: "pending" },
      { id: "s3", status: "generating_content" },
      { id: "s4", status: "completed" },
      { id: "s5", status: "idle" },
      { id: "s6", status: null },
    ];
    const prisma = createFakePrisma([], slides);

    const result = await reconcileStartupState({ prisma: prisma as never });

    expect(result.resetSlides).toBe(3);
    expect(slides.find((s) => s.id === "s1")!.status).toBe("failed");
    expect(slides.find((s) => s.id === "s2")!.status).toBe("failed");
    expect(slides.find((s) => s.id === "s3")!.status).toBe("failed");
    // Estados legítimos intactos.
    expect(slides.find((s) => s.id === "s4")!.status).toBe("completed");
    expect(slides.find((s) => s.id === "s5")!.status).toBe("idle");
    expect(slides.find((s) => s.id === "s6")!.status).toBeNull();
  });

  it("es idempotente: una segunda pasada no cambia nada", async () => {
    const jobs: JobRow[] = [
      { id: "j1", type: "extraction", status: "running", error: null, currentStep: null },
    ];
    const slides: SlideRow[] = [{ id: "s1", status: "generating_content" }];
    const prisma = createFakePrisma(jobs, slides);

    await reconcileStartupState({ prisma: prisma as never });
    const second = await reconcileStartupState({ prisma: prisma as never });

    expect(second.failedPhaseJobs).toBe(0);
    expect(second.resumedRuns).toBe(0);
    expect(second.resetSlides).toBe(0);
  });
});

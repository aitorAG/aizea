// StartupReconciler — limpieza de estados zombie al arrancar el servidor.
//
// El pipeline corre in-process pero `ProcessingJob` y `Slide.status` persisten
// en SQLite. Si la aplicación se cierra (o crashea) a mitad de un proceso,
// las filas quedan en estados no terminales sin ningún proceso vivo que las
// complete:
//
//   - Filas de FASE (`type != "pipeline-run"`, creadas por PipelineService)
//     en `running`/`pending` → huérfanas para siempre.
//   - Filas META (`type = "pipeline-run"`, creadas por PrismaJobQueue) en
//     `running` → reanudables: se devuelven a `pending` para que el próximo
//     `worker.pump()` las reclame (semántica existente de recoverStale).
//   - Slides en `pending`/`generating_content`/`generating_html` (escritas por
//     SlideGenerationQueue vía onSlideStatusChange) → marcadores eternos de
//     "generando". Se marcan `failed`; la UI ya pinta el estado rojo y
//     permite regenerarlas.
//
// Este módulo se invoca UNA VEZ desde `instrumentation.ts` al arrancar el
// servidor Next. Es idempotente: una segunda pasada no cambia nada.

import type { PrismaClient } from "@prisma/client";

/** Tipos de fila creados por PipelineService (fases del pipeline). */
const PHASE_JOB_TYPES = [
  "segmentation",
  "extraction",
  "integration",
  "tree-building",
] as const;

/** Estados no terminales que una slide NO puede conservar tras un reinicio:
 *  ningún proceso vivo va a completarlos. */
export const ZOMBIE_SLIDE_STATUSES = [
  "PENDING",
  "GENERATING",
] as const;

export interface ReconcileResult {
  /** Filas de fase huérfanas marcadas como `failed`. */
  failedPhaseJobs: number;
  /** Meta-runs (`pipeline-run`) devueltos a `pending` para reanudación. */
  resumedRuns: number;
  /** Slides en generación reseteadas a `failed`. */
  resetSlides: number;
}

export interface ReconcileOptions {
  /** Cliente Prisma inyectable (tests). Default: el singleton `db`. */
  prisma?: PrismaClient;
}

export async function reconcileStartupState(
  options: ReconcileOptions = {}
): Promise<ReconcileResult> {
  // Import dinámico del singleton: permite inyección en tests y evita tocar
  // la BD cuando el caller decide no ejecutar (p. ej. durante el build).
  const { db } = await import("@/lib/db");
  const prisma = options.prisma ?? db;

  // 1. Filas de fase huérfanas → failed. En el arranque NO hay nada corriendo
  //    in-process, así que todo lo no-terminal de fase es zombie por definición.
  const failedPhaseJobs = await prisma.processingJob.updateMany({
    where: {
      type: { in: [...PHASE_JOB_TYPES] },
      status: { in: ["pending", "running"] },
    },
    data: {
      status: "failed",
      error: "Interrumpido: la aplicación se cerró durante el proceso.",
      currentStep: "Interrumpido",
    },
  });

  // 2. Meta-runs interrumpidos → pending (reanudables por el worker).
  const resumedRuns = await prisma.processingJob.updateMany({
    where: {
      type: "pipeline-run",
      status: "running",
    },
    data: {
      status: "pending",
      currentStep: "Reanudando tras reinicio",
    },
  });

  // 3. Slides en generación → failed.
  const resetSlides = await prisma.slide.updateMany({
    where: { status: { in: [...ZOMBIE_SLIDE_STATUSES] } },
      data: { status: "FAILED" },
  });

  return {
    failedPhaseJobs: failedPhaseJobs.count,
    resumedRuns: resumedRuns.count,
    resetSlides: resetSlides.count,
  };
}

/**
 * Ejecuta la reconciliación una única vez por proceso, fire-and-forget.
 * Guard en globalThis porque Next puede recargar módulos (hot reload) y
 * registrar instrumentation más de una vez. Los errores se tragan con log:
 * si la BD aún no existe, lo único que perdemos es la limpieza de esta sesión,
 * nunca debe bloquear el arranque del servidor.
 */
let startupReconciliation: Promise<void> | null = null;

export function reconcileStartupStateOnce(): Promise<void> {
  if (startupReconciliation) return startupReconciliation;
  const g = globalThis as typeof globalThis & {
    __aizeaStartupReconciled?: boolean;
  };
  if (g.__aizeaStartupReconciled) return Promise.resolve();
  g.__aizeaStartupReconciled = true;

  startupReconciliation = reconcileStartupState()
    .then((result) => {
      if (
        result.failedPhaseJobs > 0 ||
        result.resumedRuns > 0 ||
        result.resetSlides > 0
      ) {
        console.info(
          `[StartupReconciler] jobs fase fallidos: ${result.failedPhaseJobs}, ` +
            `runs reanudados: ${result.resumedRuns}, ` +
            `slides reseteadas: ${result.resetSlides}`
        );
      }
    })
    .catch((err: unknown) => {
      console.warn(
        "[StartupReconciler] reconciliación omitida:",
        err instanceof Error ? err.message : err
      );
    });
  return startupReconciliation;
}

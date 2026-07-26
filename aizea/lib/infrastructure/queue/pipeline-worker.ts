// PipelineWorker — worker de fondo que consume la cola de runs (Fase 2.2).
//
// Drena la IJobQueue FUERA del ciclo del request: la server action encola un
// run y dispara `pump()` sin await (fire-and-forget). El worker reclama runs
// pendientes uno a uno e invoca `runCourse(courseId)` — la primitiva síncrona
// del pipeline (`ProcessCourseUseCase.execute`), que crea las filas de fase y
// las ejecuta con cancelación cooperativa (Fase 2.4) dentro.
//
// Diseño:
//   - `runCourse` se INYECTA (no se importa el use-case) para mantener el
//     worker desacoplado y testeable con un stub.
//   - `pump()` es reentrante: si ya hay un drenado en curso, retorna la misma
//     promesa en vuelo en vez de arrancar un segundo bucle. Esto evita que dos
//     enqueues concurrentes lancen dos drenados que compitan por la cola.
//   - Mapea el resultado de `runCourse` a los `mark*` de la cola:
//       ok → markCompleted · PipelineCancelledError → markCancelled ·
//       cualquier otro throw → markFailed(mensaje).

import type { IJobQueue } from "@/lib/application/ports/job-queue.port";
import { PipelineCancelledError } from "@/lib/infrastructure/pipeline/pipeline.service";

/** Contrato del worker de fondo. */
export interface IJobWorker {
  /** Drena la cola hasta vaciarla. Reentrante: llamadas concurrentes
   *  comparten el mismo drenado en vuelo. */
  pump(): Promise<void>;
  /** Resumibilidad: recupera runs `running` vetustos antes de drenar. */
  recover(): Promise<number>;
}

export interface PipelineWorkerOptions {
  queue: IJobQueue;
  /** Ejecuta el pipeline completo para un curso (primitiva síncrona). */
  runCourse: (courseId: string) => Promise<unknown>;
  /** Umbral de vetustez para recoverStale (default 10 min). */
  staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;

export class PipelineWorker implements IJobWorker {
  private readonly queue: IJobQueue;
  private readonly runCourse: (courseId: string) => Promise<unknown>;
  private readonly staleAfterMs: number;
  private draining: Promise<void> | null = null;

  constructor(options: PipelineWorkerOptions) {
    this.queue = options.queue;
    this.runCourse = options.runCourse;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  }

  async recover(): Promise<number> {
    return this.queue.recoverStale(this.staleAfterMs);
  }

  pump(): Promise<void> {
    // Reentrante: un único bucle de drenado a la vez.
    if (this.draining) return this.draining;
    this.draining = this.drain().finally(() => {
      this.draining = null;
    });
    return this.draining;
  }

  private async drain(): Promise<void> {
    // Bucle: reclama y procesa hasta que no queden pendientes.
    for (;;) {
      const run = await this.queue.claimNext();
      if (!run) return;

      try {
        await this.runCourse(run.courseId ?? "");
        await this.queue.markCompleted(run.runId);
      } catch (err) {
        if (err instanceof PipelineCancelledError) {
          await this.queue.markCancelled(run.runId);
        } else {
          const message = err instanceof Error ? err.message : String(err);
          await this.queue.markFailed(run.runId, message);
        }
      }
    }
  }
}

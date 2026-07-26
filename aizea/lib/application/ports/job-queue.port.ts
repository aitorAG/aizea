// IJobQueue — puerto de la cola de ejecución de pipelines (Fase 2.1).
//
// La cola desacopla el arranque del pipeline del ciclo del request: la
// server action ENCOLA un "pipeline-run" y retorna de inmediato; un worker
// de fondo (IJobWorker) lo consume fuera del request. El estado vive en la
// BD para sobrevivir a reinicios del proceso (resumibilidad).
//
// Implementación: `PrismaJobQueue`, respaldada en la tabla `ProcessingJob`
// existente con `type="pipeline-run"` (fila meta del run, distinta de las
// filas de fase que crea el propio pipeline). Se reusa la tabla en vez de
// crear una nueva porque los tests reconstruyen la BD replayando ficheros
// `migration.sql` concretos; añadir una tabla rompería ese replay.

import type { ProcessingStatus } from "@/lib/types/pipeline";

/** Marca de tipo de la fila meta de un run en `ProcessingJob`. */
export const PIPELINE_RUN_TYPE = "pipeline-run";

/** Datos para encolar un nuevo run. */
export interface EnqueueRunInput {
  courseId: string;
  /** Material concreto a procesar, si aplica. `null` = todos los del curso. */
  materialId?: string | null;
}

/** Fila meta de un run en la cola. */
export interface PipelineRun {
  runId: string;
  courseId: string | null;
  materialId: string | null;
  status: ProcessingStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** Contrato de la cola persistente de runs de pipeline. */
export interface IJobQueue {
  /** Encola un run nuevo en estado `pending` y devuelve su id. */
  enqueue(input: EnqueueRunInput): Promise<PipelineRun>;

  /**
   * Reclama el run `pending` más antiguo y lo marca `running` de forma
   * atómica. Devuelve `null` si no hay ninguno pendiente. El worker es único
   * in-process, así que no hay carrera entre reclamos.
   */
  claimNext(): Promise<PipelineRun | null>;

  /** Busca un run por su id. */
  findRun(runId: string): Promise<PipelineRun | null>;

  /** Marca un run como completado. */
  markCompleted(runId: string): Promise<void>;

  /** Marca un run como fallido con el mensaje de error. */
  markFailed(runId: string, error: string): Promise<void>;

  /** Marca un run como cancelado (idempotente en estados terminales). */
  markCancelled(runId: string): Promise<void>;

  /**
   * Resumibilidad: devuelve a `pending` los runs `running` cuyo `updatedAt`
   * es más antiguo que `olderThanMs` (el proceso murió a mitad). El pipeline
   * salta las fases ya hechas (`hasProcessedUnits`), así que reprocesar
   * reanuda de facto. Devuelve el número de runs recuperados.
   */
  recoverStale(olderThanMs: number): Promise<number>;
}

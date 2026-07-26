// Puerto de concurrencia acotada (PR1 — paralelización del pipeline).
//
// Encapsula la ejecución de N tareas asíncronas con como máximo `limit` en
// vuelo simultáneamente. Es el mecanismo con el que la fase de extracción
// (1 llamada LLM por unidad, el cuello de botella del pipeline) pasa de
// serial a paralela sin saturar el rate-limit del proveedor LLM.
//
// Diseño (contrato, no implementación):
//   - Preserva el ORDEN: results[i] corresponde a items[i], sin importar el
//     orden en que terminen las tareas.
//   - Cancelación cooperativa vía AbortSignal: al abortar, NO se arrancan
//     tareas nuevas y se espera a que drenen las en curso (nunca deja
//     llamadas colgando). Rechaza con un AbortError.
//   - Fail-fast: al primer error, deja de arrancar tareas nuevas, espera a
//     que terminen las en vuelo y rechaza con ese primer error. No deja
//     promesas huérfanas.
//   - Progreso: callback opcional invocado cada vez que una tarea completa,
//     con el nº de completadas y el total (para actualizar ProcessingJob).

export interface BoundedMapOptions {
  /** Máximo de tareas en vuelo simultáneamente. Debe ser >= 1. */
  limit: number;
  /** Señal de cancelación cooperativa. Al abortar, no se arrancan nuevas
   *  tareas y se espera a las en curso. */
  signal?: AbortSignal;
  /** Invocado tras cada tarea completada con éxito. `completed` es el número
   *  acumulado de tareas terminadas; `total` es items.length. */
  onProgress?: (completed: number, total: number) => void;
}

export interface IBoundedPool {
  /**
   * Ejecuta `fn` sobre cada item con como máximo `options.limit` en vuelo.
   * Devuelve los resultados en el MISMO orden que `items`.
   *
   * @throws el primer error lanzado por cualquier `fn` (tras drenar las
   *   tareas en curso), o un AbortError si `options.signal` se aborta.
   */
  map<T, R>(
    items: readonly T[],
    fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
    options: BoundedMapOptions
  ): Promise<R[]>;
}

/** Error lanzado cuando el pool se aborta vía AbortSignal. */
export class PoolAbortedError extends Error {
  constructor(message = "Operación abortada") {
    super(message);
    this.name = "PoolAbortedError";
  }
}

// BoundedPool — implementación del puerto IBoundedPool (PR1).
//
// Worker-pool clásico: se lanzan `limit` "workers" que consumen ítems de un
// índice compartido hasta agotar la lista. No usa librerías externas.
//
// Garantías (ver el puerto para el contrato):
//   - Orden preservado: cada resultado se guarda en su índice original.
//   - Concurrencia acotada: como mucho `limit` tareas en vuelo a la vez.
//   - Fail-fast sin huérfanos: al primer error (o abort) se deja de tomar
//     ítems nuevos; las tareas ya en vuelo terminan (se esperan) antes de
//     rechazar. Así no queda ninguna promesa colgando tras el rechazo.
//   - Abort cooperativo: el AbortSignal se propaga a cada `fn` y también
//     corta la toma de nuevos ítems.

import {
  type BoundedMapOptions,
  type IBoundedPool,
  PoolAbortedError,
} from "@/lib/application/ports/concurrency.port";

export class BoundedPool implements IBoundedPool {
  async map<T, R>(
    items: readonly T[],
    fn: (item: T, index: number, signal: AbortSignal) => Promise<R>,
    options: BoundedMapOptions
  ): Promise<R[]> {
    const { signal, onProgress } = options;
    const total = items.length;
    if (total === 0) return [];

    const limit = Math.max(1, Math.floor(options.limit));
    const results = new Array<R>(total);

    // Estado compartido entre workers.
    let nextIndex = 0;
    let completed = 0;
    let firstError: unknown = null;
    let aborted = signal?.aborted ?? false;

    // Si ya venía abortado, ni arrancamos.
    if (aborted) {
      throw new PoolAbortedError();
    }

    // Un abort a mitad detiene la toma de nuevos ítems. Las tareas en vuelo
    // reciben el signal y deciden cómo cortar; aquí solo dejamos de repartir.
    const onAbort = (): void => {
      aborted = true;
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const workerSignal: AbortSignal =
      signal ?? new AbortController().signal;

    const runWorker = async (): Promise<void> => {
      // Cada worker toma ítems mientras queden y no haya error/abort.
      while (true) {
        if (firstError !== null || aborted) return;
        const index = nextIndex;
        if (index >= total) return;
        nextIndex += 1;

        try {
          const value = await fn(items[index], index, workerSignal);
          results[index] = value;
          completed += 1;
          if (onProgress) {
            try {
              onProgress(completed, total);
            } catch {
              // Un fallo en el reporte de progreso jamás debe tumbar el pool.
            }
          }
        } catch (err) {
          // Guardamos SOLO el primer error; los demás workers verán
          // firstError !== null y saldrán sin tomar más ítems.
          if (firstError === null) firstError = err;
          return;
        }
      }
    };

    const workerCount = Math.min(limit, total);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(runWorker());
    }

    // Esperamos a que TODOS los workers terminen (drenaje), incluso si uno ya
    // falló: los que estaban en vuelo completan antes de que rechacemos.
    try {
      await Promise.all(workers);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    if (firstError !== null) {
      throw firstError;
    }
    if (aborted) {
      throw new PoolAbortedError();
    }
    return results;
  }
}

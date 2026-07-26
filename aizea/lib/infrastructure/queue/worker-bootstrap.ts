// Worker bootstrap (Fase 3-B).
//
// Runs once when the Node process starts (invoked from `instrumentation.ts`
// via Next's `register()` hook). It relocates the worker's startup out of the
// request path: instead of relying solely on `startPipelineAction` firing the
// pump, the process itself:
//
//   1. RECOVERS runs left `running` by a previous crash (resumibilidad a nivel
//      proceso) — so a hard kill mid-pipeline doesn't strand the run.
//   2. PUMPS the queue so any pending runs (recovered or enqueued while the
//      process was down) start draining immediately on boot.
//
// Kept as a pure function over the worker port so it is unit-testable without
// Next.js. Idempotent-friendly: a guard flag prevents a double bootstrap if
// `register()` fires more than once in a single process.

export interface BootstrapWorkerDeps {
  recover: () => Promise<number>;
  pump: () => Promise<void>;
  /** Optional logger; defaults to console. */
  log?: (message: string) => void;
}

let bootstrapped = false;

/**
 * Recover stale runs then drain the queue. Never throws — a failed bootstrap
 * must not crash process startup; the per-request pump remains a fallback.
 */
export async function bootstrapWorker(deps: BootstrapWorkerDeps): Promise<void> {
  const log = deps.log ?? ((m: string) => console.log(`[worker-bootstrap] ${m}`));
  try {
    const recovered = await deps.recover();
    if (recovered > 0) {
      log(`recovered ${recovered} stale run(s) left running by a prior crash`);
    }
    // Fire-and-forget the drain: bootstrap returns once recovery is done and
    // the pump has been kicked, without blocking process startup on a long
    // pipeline. The worker's pump is reentrant, so a concurrent request-time
    // pump is safe.
    void deps.pump().catch((err) => {
      log(`pump failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } catch (err) {
    log(`bootstrap failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Test-only reset of the once-guard. */
export function __resetBootstrapGuardForTests(): void {
  bootstrapped = false;
}

/**
 * Guarded entry point for `instrumentation.ts`: runs `bootstrapWorker` at most
 * once per process. Subsequent calls are no-ops.
 */
export async function bootstrapWorkerOnce(deps: BootstrapWorkerDeps): Promise<void> {
  if (bootstrapped) return;
  bootstrapped = true;
  await bootstrapWorker(deps);
}

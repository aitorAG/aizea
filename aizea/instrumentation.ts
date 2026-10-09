// Instrumentation hook de Next.js 15 (https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation).
//
// `register()` se ejecuta UNA VEZ cuando arranca el servidor (antes de servir
// requests). Lo usamos para reconciliar estados zombie dejados por cierres
// anteriores de la aplicación:
//   - ProcessingJob de fase en running/pending → failed
//   - meta-runs pipeline-run en running → pending (reanudables)
//   - Slides pending/generating_* → failed
//
// Ver `lib/infrastructure/pipeline/startup-reconciler.ts`.

export async function register(): Promise<void> {
  // No ejecutar durante `next build` (no hay BD del usuario garantizada y el
  // build no debe tocar datos).
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  // Instrumentation may be evaluated by more than one Next runtime. The
  // reconciler imports Prisma, filesystem paths and LanceDB, so it is strictly
  // Node-only. Keep the import inside Next's recognized positive runtime guard
  // so it is excluded from the edge bundle.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reconcileStartupStateOnce } = await import(
      "@/lib/infrastructure/pipeline/startup-reconciler"
    );
    reconcileStartupStateOnce();
  }
}

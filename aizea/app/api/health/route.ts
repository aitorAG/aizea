// GET /api/health — readiness probe (Fase 3-A) + worker bootstrap trigger (3-B).
//
// Polled by the Tauri supervisor to know when the bundled Node server is
// ready. Returns 200 when the DB answers, 503 otherwise. The health LOGIC
// lives in `lib/application/health.ts` (unit-tested); this route only wires
// the real DB ping and maps the report to an HTTP status.
//
// Fase 3-B — worker bootstrap: this route (a Node-runtime route handler, where
// `serverExternalPackages` applies and the container's native deps load fine)
// is where we kick the worker's recover()+pump() ONCE per process. The Tauri
// supervisor polls /api/health at launch, so this fires at effective process
// startup — WITHOUT an `instrumentation.ts`, which forced the container into
// the edge bundle and broke the build by pulling lancedb's native .node binary
// into a browser target. Fire-and-forget: a bootstrap failure must never make
// the readiness probe report unhealthy.

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkHealth } from "@/lib/application/health";
import { container } from "@/lib/composition/container";
import { bootstrapWorkerOnce } from "@/lib/infrastructure/queue/worker-bootstrap";
import { reconcileSchema } from "@/lib/infrastructure/persistence/schema-reconciler";

// Always dynamic: readiness must reflect the live process, never a cache.
export const dynamic = "force-dynamic";

// Desktop upgrade safety: reconcile the DB schema against the DMMF ONCE per
// process, before the worker touches any table. On an upgrade the seeded
// db.sqlite is NOT re-copied (it already exists), so new columns must be
// added here. Guarded so the (possibly repeated) health polls run it once.
let schemaReconciled: Promise<void> | null = null;
function reconcileSchemaOnce(): Promise<void> {
  if (!schemaReconciled) {
    schemaReconciled = reconcileSchema(db).then(() => undefined);
  }
  return schemaReconciled;
}

export async function GET(): Promise<NextResponse> {
  const report = await checkHealth({
    pingDb: async () => {
      // Cheapest possible round-trip that proves the SQLite file is open
      // and answering. `SELECT 1` avoids depending on any table existing.
      await db.$queryRaw`SELECT 1`;
    },
    version: process.env.npm_package_version ?? "0.2.0",
  });

  // Reconcile the schema, THEN kick the worker bootstrap — both once per
  // process, only when the DB answers. The worker's recover()/pump() read
  // tables (incl. columns added by an upgrade), so reconciliation must finish
  // first. Not awaited by the response: readiness must not block on either.
  if (report.status === "ok") {
    void reconcileSchemaOnce().then(() =>
      bootstrapWorkerOnce({
        recover: () => container.pipelineWorker.recover(),
        pump: () => container.pipelineWorker.pump(),
      })
    );
  }

  return NextResponse.json(report, {
    status: report.status === "ok" ? 200 : 503,
  });
}

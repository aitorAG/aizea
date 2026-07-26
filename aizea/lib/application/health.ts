// Health/readiness check (Fase 3-A).
//
// The Tauri supervisor (src-tauri/src/lib.rs) polls this to know WHEN the
// bundled Node server is actually ready to serve — replacing the previous
// blind `sleep(3000ms)` before opening the window. "Ready" means the process
// is up AND its critical dependency (the SQLite DB) answers a trivial query.
//
// Kept as a pure function (injectable ping) so it is unit-testable without
// spinning up Next.js: the route is a thin adapter over `checkHealth`.

export type HealthStatus = "ok" | "unavailable";

export interface HealthReport {
  status: HealthStatus;
  /** True when the DB answered the readiness ping. */
  db: boolean;
  /** App version, echoed so the supervisor/logs can confirm the build. */
  version: string;
  /** Millisecond epoch of the check. */
  timestamp: number;
}

export interface CheckHealthDeps {
  /** Trivial DB round-trip. Resolves if the DB is reachable, throws otherwise. */
  pingDb: () => Promise<void>;
  /** App version string. */
  version?: string;
}

/**
 * Run the readiness check. Never throws: a failed DB ping is reported as
 * `status: "unavailable"` so the caller can map it to a 503.
 */
export async function checkHealth(deps: CheckHealthDeps): Promise<HealthReport> {
  const version = deps.version ?? "unknown";
  let db = false;
  try {
    await deps.pingDb();
    db = true;
  } catch {
    db = false;
  }
  return {
    status: db ? "ok" : "unavailable",
    db,
    version,
    timestamp: Date.now(),
  };
}

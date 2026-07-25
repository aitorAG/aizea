import { PrismaClient } from "@prisma/client";
import { getDbPath } from "@/lib/paths";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  // Resolve the datasource URL EXPLICITLY and pass it to the
  // PrismaClient constructor. This is the only way to guarantee
  // Prisma connects to the right SQLite file in every deployment
  // mode:
  //
  //   - Desktop (Tauri): the Rust launcher sets DATABASE_URL to
  //     file:%APPDATA%/com.aizea.app/db.sqlite. We pass it through.
  //   - Dev / web: DATABASE_URL comes from .env (file:./dev.db).
  //
  // Relying on the env var alone is fragile: the Prisma client's
  // embedded schema.prisma contains `url = "file:./dev.db"` as a
  // fallback, and that path resolves relative to the schema file
  // (node_modules/.prisma/client/), not to CWD. In the standalone
  // desktop build this caused Prisma to open a stale 4KB dev.db
  // inside .prisma/client/ that lacked the TopicNode and Slide
  // tables, crashing every dynamic route.
  const datasourceUrl =
    process.env.DATABASE_URL ??
    (process.env.AIZEA_DATA_DIR
      ? `file:${getDbPath().replace(/\\/g, "/")}`
      : undefined);

  return new PrismaClient(
    datasourceUrl ? { datasourceUrl } : undefined
  );
}

export const db = globalForPrisma.prisma ?? createPrismaClient();

// Enable WAL mode for better concurrent read/write performance.
// Also set busy_timeout so SQLite waits up to 5 s before returning
// SQLITE_BUSY — important for the desktop build where multiple
// processes may share the same dev.db.
(async () => {
  try {
    await db.$queryRawUnsafe(`PRAGMA journal_mode=WAL`);
    await db.$queryRawUnsafe(`PRAGMA busy_timeout=5000`);
  } catch (err) {
    console.error(
      "[db] Failed to set WAL mode or busy_timeout. Concurrent writes may fail.",
      err
    );
  }
})();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

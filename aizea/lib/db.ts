import { PrismaClient } from "@prisma/client";
import { getDatabaseUrl } from "@/lib/paths";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createPrismaClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: getDatabaseUrl() });
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

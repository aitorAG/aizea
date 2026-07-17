import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

// Enable WAL mode for better concurrent read/write performance
// Use $queryRawUnsafe because PRAGMA journal_mode returns rows (the new mode name).
// $executeRawUnsafe throws P2010 on queries that produce result rows.
db.$queryRawUnsafe(`PRAGMA journal_mode=WAL`).catch(console.error);

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}

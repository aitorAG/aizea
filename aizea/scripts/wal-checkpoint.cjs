// Checkpoint only an explicitly selected SQLite database.
const { PrismaClient } = require("@prisma/client");
const { resolveDatabaseUrl } = require("./prisma.cjs");

async function main() {
  const url = process.argv[2] || process.env.DATABASE_URL;
  if (!url) throw new Error("Pass an explicit SQLite DATABASE_URL to checkpoint.");
  const db = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl({}, url) } } });
  try {
    await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    console.log("SQLite WAL checkpoint complete.");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("Checkpoint failed:", error.message);
  process.exitCode = 1;
});

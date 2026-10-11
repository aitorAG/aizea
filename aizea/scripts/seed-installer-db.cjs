#!/usr/bin/env node
// Validate and empty the database that will be bundled with the installer.

const { PrismaClient } = require("@prisma/client");
const { existsSync, rmSync } = require("node:fs");
const { join } = require("node:path");

const ROOT = join(__dirname, "..");
const DB_PATH = process.argv[2] || join(ROOT, ".next", "standalone", "db.sqlite");
const REQUIRED_COLUMNS = {
  Course: ["id", "name"],
  Slide: ["id", "courseId", "numericPath", "status"],
  TopicNode: ["id", "courseId", "numericPath"],
  Settings: ["id", "openrouterApiKey"],
  ProcessingJob: ["id", "status"],
};

function databaseUrl(filePath) {
  return `file:${filePath.replace(/\\/g, "/")}`;
}

async function main() {
  if (!existsSync(DB_PATH)) throw new Error(`${DB_PATH} was not created.`);
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl(DB_PATH) } } });
  try {
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
      const rows = await db.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
      const available = new Set(rows.map((row) => row.name));
      const missing = columns.filter((column) => !available.has(column));
      if (missing.length > 0) throw new Error(`Required schema missing ${table}.${missing.join(", ")}`);
    }
    const tables = await db.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%'`
    );
    await db.$executeRawUnsafe("PRAGMA foreign_keys=OFF");
    let wiped = 0;
    for (const { name } of tables) {
      const before = await db.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM "${name}"`);
      const count = Number(before[0].c);
      if (count > 0) {
        await db.$executeRawUnsafe(`DELETE FROM "${name}"`);
        wiped += count;
      }
    }
    await db.$executeRawUnsafe("PRAGMA foreign_keys=ON");
    await db.$queryRawUnsafe("VACUUM");
    await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    console.log(`Installer database validated and emptied (${wiped} rows removed).`);
  } finally {
    await db.$disconnect();
  }
  for (const ext of ["-wal", "-shm", "-journal"]) {
    const sidecar = `${DB_PATH}${ext}`;
    if (existsSync(sidecar)) rmSync(sidecar, { force: true });
  }
}

main().catch((error) => {
  console.error(`Installer database preparation failed: ${error.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
// seed-installer-db.cjs — Empty the SQLite database that ships inside the
// installer so a fresh install starts with ZERO courses/materials/etc.
//
// Why: build-msi.cjs copies the developer's prisma/dev.db (correct schema, but
// full of dev/test data) into .next/standalone/db.sqlite. That data would then
// appear on every user's machine. This script wipes every row from the COPY
// (standalone/db.sqlite) — never the source dev.db — keeping the schema intact.
//
// It targets the standalone copy via a Prisma datasources override, enumerates
// user tables from sqlite_master (so it's schema-drift proof — no hardcoded
// table list), deletes all rows with FKs off, then checkpoints + drops the
// WAL/SHM sidecars so only the clean main .db file is bundled.

const { PrismaClient } = require("@prisma/client");
const { existsSync, rmSync } = require("fs");
const { join } = require("path");

const ROOT = join(__dirname, "..");
const STANDALONE = join(ROOT, ".next", "standalone");
const DB_PATH = join(STANDALONE, "db.sqlite");

function log(msg) {
  console.log(`\x1b[36m[seed-installer-db]\x1b[0m ${msg}`);
}

async function main() {
  if (!existsSync(DB_PATH)) {
    console.error(
      `\x1b[31m[seed-installer-db]\x1b[0m ${DB_PATH} not found. ` +
        "Run the copy step in build-msi.cjs first."
    );
    process.exit(1);
  }

  // Absolute file: URL with forward slashes so Prisma opens exactly this copy
  // (NOT dev.db from .env).
  const url = `file:${DB_PATH.replace(/\\/g, "/")}`;
  const db = new PrismaClient({ datasources: { db: { url } } });

  try {
    const tables = await db.$queryRawUnsafe(
      `SELECT name FROM sqlite_master
       WHERE type='table'
         AND name NOT LIKE 'sqlite_%'
         AND name NOT LIKE '_prisma_%'`
    );

    await db.$executeRawUnsafe("PRAGMA foreign_keys=OFF");
    let wiped = 0;
    for (const { name } of tables) {
      const before = await db.$queryRawUnsafe(
        `SELECT COUNT(*) as c FROM "${name}"`
      );
      const count = Number(before[0].c);
      if (count > 0) {
        await db.$executeRawUnsafe(`DELETE FROM "${name}"`);
        wiped += count;
        log(`  cleared ${count} row(s) from "${name}"`);
      }
    }
    await db.$executeRawUnsafe("PRAGMA foreign_keys=ON");
    // Reclaim space and flush WAL into the main file. Both can return rows in
    // SQLite, so use $queryRawUnsafe ($executeRawUnsafe rejects result sets).
    await db.$queryRawUnsafe("VACUUM");
    await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    log(`Emptied installer db (${wiped} row(s) removed across ${tables.length} tables).`);
  } finally {
    await db.$disconnect();
  }

  // Drop WAL/SHM sidecars so only the clean main .db is bundled.
  for (const ext of ["-wal", "-shm"]) {
    const f = `${DB_PATH}${ext}`;
    if (existsSync(f)) rmSync(f, { force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\x1b[31m[seed-installer-db]\x1b[0m failed:", e.message);
    process.exit(1);
  });

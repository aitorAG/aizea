// Test helper — apply ALL Prisma migrations in order to a fresh SQLite DB.
//
// Historically each integration test hard-coded a single migration.sql path,
// so any NEW migration (e.g. the sectionPath column) was invisible to the
// replayed test schema and Prisma inserts against the new column failed. This
// helper reads every `migrations/<timestamp>/migration.sql`, sorts by folder
// name (timestamps sort lexicographically = chronologically), and executes
// each statement. New migrations are picked up automatically.

import { PrismaClient } from "@prisma/client";
import { readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

/** Split a migration.sql file into individual executable statements. */
function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^--.*$/gm, "").trim())
    .filter((s) => s.length > 0);
}

/** Ordered list of every migration.sql path (chronological by folder name). */
export function migrationSqlFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => join(MIGRATIONS_DIR, name, "migration.sql"))
    .filter((p) => existsSync(p));
}

/** Remove a SQLite DB file and its WAL/SHM/journal sidecars. */
export function removeDbFiles(dbPath: string): void {
  for (const suffix of ["", "-journal", "-shm", "-wal"]) {
    if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix, { force: true });
  }
}

/**
 * Create a fresh SQLite DB at `dbPath` with the FULL migration history applied.
 * Returns a connected PrismaClient bound to it.
 */
export async function createMigratedTestDb(
  dbPath: string
): Promise<PrismaClient> {
  removeDbFiles(dbPath);
  const url = `file:${dbPath}`;
  process.env.DATABASE_URL = url;
  const db = new PrismaClient({ datasources: { db: { url } } });
  for (const file of migrationSqlFiles()) {
    const sql = readFileSync(file, "utf-8");
    for (const stmt of splitStatements(sql)) {
      await db.$executeRawUnsafe(stmt);
    }
  }
  return db;
}

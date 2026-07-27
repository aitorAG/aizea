// Schema reconciler (desktop upgrade safety).
//
// PROBLEM this removes: the desktop app ships a pre-seeded db.sqlite and the
// Rust launcher only copies it on FIRST run (when %APPDATA%/AIzea/db.sqlite
// does not exist). On an UPGRADE the old database is left untouched, so any
// column added in a new version (e.g. SemanticUnit.sectionPath in 0.4.0) is
// missing at runtime → "column X does not exist". Replaying prisma migrations
// is not viable offline (the schema-engine binary is not bundled and the
// migrations folder is incomplete — some columns only ever entered via
// `db push`).
//
// FIX: reconcile the live database against Prisma's DMMF (the datamodel the
// generated client already carries, so it is ALWAYS in sync with
// schema.prisma and ships inside the standalone bundle — zero extra binary).
// On startup we add any missing scalar column with an idempotent
// `ALTER TABLE ADD COLUMN`. This makes the whole class of "new column breaks
// upgrades" bugs impossible, for this and every future additive change.
//
// Scope: ADDITIVE, non-destructive. It adds missing columns. It never drops,
// renames, or retypes, and it does not create missing tables (a brand-new
// table means a fresh seed, handled by the first-run copy). Additive column
// changes are the real-world case and cover 0.4.0's sectionPath.

import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

/** Minimal shape of a DMMF scalar field we rely on (kept local so tests can
 *  build fixtures without importing Prisma internals). */
export interface ReconcilerField {
  name: string;
  kind: string; // "scalar" | "object" | "enum"
  type: string; // "String" | "Int" | "Boolean" | "Float" | "DateTime" | ...
  isRequired: boolean;
  hasDefaultValue: boolean;
  default?: unknown;
  dbName?: string | null;
}

export interface ReconcilerModel {
  name: string;
  dbName?: string | null;
  fields: ReconcilerField[];
}

/** Map a Prisma scalar type to its SQLite column type. */
export function sqliteType(prismaType: string): string {
  switch (prismaType) {
    case "Int":
    case "BigInt":
      return "INTEGER";
    case "Float":
    case "Decimal":
      return "REAL";
    case "Boolean":
      return "BOOLEAN";
    case "DateTime":
      return "DATETIME";
    case "Bytes":
      return "BLOB";
    default:
      // String, Json, enums (stored as text) → TEXT.
      return "TEXT";
  }
}

/** Render a SQLite literal for a NOT NULL column's DEFAULT. Prefers the DMMF
 *  literal default; falls back to a type-appropriate zero value when the
 *  default is a function (uuid()/now()) that has no constant form usable in
 *  `ADD COLUMN`. Returns null when no default is needed (nullable column). */
export function defaultLiteral(field: ReconcilerField): string | null {
  if (!field.isRequired) return null; // nullable → no DEFAULT needed

  const d = field.default;
  const isFnDefault =
    d !== null && typeof d === "object" && d !== undefined && "name" in (d as object);

  if (field.hasDefaultValue && d !== undefined && !isFnDefault) {
    // Literal default from the schema (e.g. "[]" for sectionPath, 0, true…).
    if (typeof d === "string") return `'${d.replace(/'/g, "''")}'`;
    if (typeof d === "number") return String(d);
    if (typeof d === "boolean") return d ? "1" : "0";
  }

  // Required column with a function/absent default → SQLite ADD COLUMN needs a
  // CONSTANT default. Use a type-appropriate neutral value so the ALTER
  // succeeds; existing rows get a placeholder rather than blocking the upgrade.
  switch (sqliteType(field.type)) {
    case "INTEGER":
    case "REAL":
    case "BOOLEAN":
      return "0";
    case "DATETIME":
      return "'1970-01-01 00:00:00'";
    default:
      return "''";
  }
}

/** Build the `ALTER TABLE … ADD COLUMN …` DDL for a single missing field.
 *  Pure/testable. */
export function buildAddColumnSql(
  tableName: string,
  field: ReconcilerField
): string {
  const col = field.dbName ?? field.name;
  const type = sqliteType(field.type);
  const notNull = field.isRequired ? " NOT NULL" : "";
  const def = defaultLiteral(field);
  const defClause = def !== null ? ` DEFAULT ${def}` : "";
  // SQLite column definition order: name TYPE [NOT NULL] [DEFAULT …].
  return `ALTER TABLE "${tableName}" ADD COLUMN "${col}" ${type}${notNull}${defClause}`
    .replace(/\s+/g, " ")
    .trim();
}

export interface ReconcileResult {
  /** Columns added, as "Table.column". */
  added: string[];
  /** Tables in the datamodel that don't exist yet (reported, not created). */
  missingTables: string[];
}

interface ReconcileDeps {
  /** Run a raw statement (mapped to prisma.$executeRawUnsafe in prod). */
  exec: (sql: string) => Promise<unknown>;
  /** Query rows (mapped to prisma.$queryRawUnsafe in prod). */
  query: <T = unknown>(sql: string) => Promise<T[]>;
  /** Datamodel models (defaults to Prisma.dmmf). Injectable for tests. */
  models?: ReconcilerModel[];
  log?: (message: string) => void;
}

/** Core reconciliation over injectable deps — unit-testable without Prisma. */
export async function reconcileSchemaWith(
  deps: ReconcileDeps
): Promise<ReconcileResult> {
  const log = deps.log ?? ((m) => console.log(`[schema-reconcile] ${m}`));
  const models =
    deps.models ??
    (Prisma.dmmf.datamodel.models as unknown as ReconcilerModel[]);

  const added: string[] = [];
  const missingTables: string[] = [];

  for (const model of models) {
    const table = model.dbName ?? model.name;

    // Existing columns of the table (empty array if the table is absent).
    const info = await deps.query<{ name: string }>(
      `PRAGMA table_info("${table}")`
    );
    if (info.length === 0) {
      // No such table → this is a fresh-install concern, not an additive
      // upgrade. Report it; don't attempt CREATE TABLE (FKs/indexes belong to
      // the seed).
      missingTables.push(table);
      continue;
    }
    const existing = new Set(info.map((c) => c.name));

    for (const field of model.fields) {
      if (field.kind !== "scalar") continue; // skip relations/enums-as-objects
      const col = field.dbName ?? field.name;
      if (existing.has(col)) continue;

      const sql = buildAddColumnSql(table, field);
      await deps.exec(sql);
      added.push(`${table}.${col}`);
      log(`added ${table}.${col}`);
    }
  }

  if (added.length === 0 && missingTables.length === 0) {
    log("schema up to date; nothing to reconcile");
  }
  return { added, missingTables };
}

/**
 * Production entry point: reconcile the live database behind the given
 * PrismaClient against the generated DMMF. Never throws — a reconciliation
 * failure must not crash startup (the app may still work for unaffected
 * features, and the error is logged for diagnosis).
 */
export async function reconcileSchema(
  prisma: PrismaClient,
  log?: (message: string) => void
): Promise<ReconcileResult> {
  const logger = log ?? ((m: string) => console.log(`[schema-reconcile] ${m}`));
  try {
    return await reconcileSchemaWith({
      exec: (sql) => prisma.$executeRawUnsafe(sql),
      query: (sql) => prisma.$queryRawUnsafe(sql),
      log: logger,
    });
  } catch (err) {
    logger(
      `reconcile failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return { added: [], missingTables: [] };
  }
}

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { join } from "node:path";
import {
  buildAddColumnSql,
  defaultLiteral,
  sqliteType,
  reconcileSchemaWith,
  type ReconcilerModel,
  type ReconcilerField,
} from "@/lib/infrastructure/persistence/schema-reconciler";
import { removeDbFiles } from "../../helpers/migrate-test-db";

// ----- pure DDL builder (no DB) -----

function field(overrides: Partial<ReconcilerField>): ReconcilerField {
  return {
    name: "col",
    kind: "scalar",
    type: "String",
    isRequired: false,
    hasDefaultValue: false,
    default: undefined,
    dbName: null,
    ...overrides,
  };
}

describe("schema-reconciler: pure DDL", () => {
  it("maps Prisma scalar types to SQLite types", () => {
    expect(sqliteType("String")).toBe("TEXT");
    expect(sqliteType("Int")).toBe("INTEGER");
    expect(sqliteType("Float")).toBe("REAL");
    expect(sqliteType("Boolean")).toBe("BOOLEAN");
    expect(sqliteType("DateTime")).toBe("DATETIME");
    expect(sqliteType("Json")).toBe("TEXT");
  });

  it("nullable column needs no DEFAULT", () => {
    expect(defaultLiteral(field({ isRequired: false }))).toBeNull();
  });

  it("required column with a literal string default quotes it", () => {
    const f = field({ isRequired: true, hasDefaultValue: true, default: "[]" });
    expect(defaultLiteral(f)).toBe("'[]'");
  });

  it("escapes single quotes in a string default", () => {
    const f = field({ isRequired: true, hasDefaultValue: true, default: "a'b" });
    expect(defaultLiteral(f)).toBe("'a''b'");
  });

  it("required column with a function default falls back to a neutral literal", () => {
    // e.g. @default(uuid()) — no constant form usable in ADD COLUMN.
    const f = field({
      isRequired: true,
      hasDefaultValue: true,
      default: { name: "uuid", args: [4] },
    });
    expect(defaultLiteral(f)).toBe("''"); // TEXT neutral
  });

  it("required DateTime with function default uses a constant timestamp", () => {
    const f = field({
      type: "DateTime",
      isRequired: true,
      hasDefaultValue: true,
      default: { name: "now", args: [] },
    });
    expect(defaultLiteral(f)).toBe("'1970-01-01 00:00:00'");
  });

  it("builds ADD COLUMN DDL for a required defaulted column (sectionPath case)", () => {
    const sql = buildAddColumnSql(
      "SemanticUnit",
      field({ name: "sectionPath", isRequired: true, hasDefaultValue: true, default: "[]" })
    );
    expect(sql).toBe(
      `ALTER TABLE "SemanticUnit" ADD COLUMN "sectionPath" TEXT NOT NULL DEFAULT '[]'`
    );
  });

  it("builds ADD COLUMN DDL for a nullable column (no NOT NULL, no DEFAULT)", () => {
    const sql = buildAddColumnSql(
      "Slide",
      field({ name: "sourceNodeId", type: "String", isRequired: false })
    );
    expect(sql).toBe(`ALTER TABLE "Slide" ADD COLUMN "sourceNodeId" TEXT`);
  });

  it("honours dbName override for the column name", () => {
    const sql = buildAddColumnSql(
      "T",
      field({ name: "camelCase", dbName: "snake_case", isRequired: false })
    );
    expect(sql).toContain(`"snake_case"`);
    expect(sql).not.toContain("camelCase");
  });
});

// ----- reconciler against a real SQLite DB -----

describe("schema-reconciler: live reconciliation", () => {
  const TEST_DB = join(process.cwd(), "prisma", "test-schema-reconciler.db");
  let db: PrismaClient;

  beforeEach(async () => {
    removeDbFiles(TEST_DB);
    const url = `file:${TEST_DB}`;
    db = new PrismaClient({ datasources: { db: { url } } });
    // Simulate a STALE (pre-0.4.0) SemanticUnit table: everything except the
    // new sectionPath column.
    await db.$executeRawUnsafe(`
      CREATE TABLE "SemanticUnit" (
        "id" TEXT PRIMARY KEY,
        "materialId" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "order" INTEGER NOT NULL,
        "pageStart" INTEGER,
        "pageEnd" INTEGER,
        "sectionRef" TEXT,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });

  afterEach(async () => {
    if (db) await db.$disconnect();
    removeDbFiles(TEST_DB);
  });

  /** A minimal datamodel matching the live table PLUS the new column. */
  const model: ReconcilerModel = {
    name: "SemanticUnit",
    dbName: null,
    fields: [
      { name: "id", kind: "scalar", type: "String", isRequired: true, hasDefaultValue: true, default: { name: "uuid", args: [4] } },
      { name: "materialId", kind: "scalar", type: "String", isRequired: true, hasDefaultValue: false },
      { name: "content", kind: "scalar", type: "String", isRequired: true, hasDefaultValue: false },
      { name: "order", kind: "scalar", type: "Int", isRequired: true, hasDefaultValue: false },
      { name: "pageStart", kind: "scalar", type: "Int", isRequired: false, hasDefaultValue: false },
      { name: "pageEnd", kind: "scalar", type: "Int", isRequired: false, hasDefaultValue: false },
      { name: "sectionRef", kind: "scalar", type: "String", isRequired: false, hasDefaultValue: false },
      { name: "sectionPath", kind: "scalar", type: "String", isRequired: true, hasDefaultValue: true, default: "[]" },
      { name: "createdAt", kind: "scalar", type: "DateTime", isRequired: true, hasDefaultValue: true, default: { name: "now", args: [] } },
      // A relation field must be ignored by the reconciler.
      { name: "representation", kind: "object", type: "UnitRepresentation", isRequired: false, hasDefaultValue: false },
    ],
  };

  function deps() {
    return {
      exec: (sql: string) => db.$executeRawUnsafe(sql),
      query: <T = unknown>(sql: string) => db.$queryRawUnsafe<T[]>(sql),
      models: [model],
      log: () => {},
    };
  }

  it("adds the missing sectionPath column", async () => {
    const result = await reconcileSchemaWith(deps());
    expect(result.added).toContain("SemanticUnit.sectionPath");

    const info = await db.$queryRawUnsafe<{ name: string }[]>(
      `PRAGMA table_info("SemanticUnit")`
    );
    expect(info.map((c) => c.name)).toContain("sectionPath");
  });

  it("new rows get the default '[]' for the added column", async () => {
    await reconcileSchemaWith(deps());
    await db.$executeRawUnsafe(
      `INSERT INTO "SemanticUnit" ("id","materialId","content","order") VALUES ('u1','m1','x',0)`
    );
    const rows = await db.$queryRawUnsafe<{ sectionPath: string }[]>(
      `SELECT "sectionPath" FROM "SemanticUnit" WHERE "id"='u1'`
    );
    expect(rows[0].sectionPath).toBe("[]");
  });

  it("is idempotent — a second run adds nothing", async () => {
    await reconcileSchemaWith(deps());
    const second = await reconcileSchemaWith(deps());
    expect(second.added).toEqual([]);
  });

  it("does not touch columns that already exist", async () => {
    const before = await db.$queryRawUnsafe<{ name: string }[]>(
      `PRAGMA table_info("SemanticUnit")`
    );
    await reconcileSchemaWith(deps());
    const after = await db.$queryRawUnsafe<{ name: string }[]>(
      `PRAGMA table_info("SemanticUnit")`
    );
    // Same columns as before + exactly one new (sectionPath).
    expect(after.length).toBe(before.length + 1);
  });

  it("ignores relation (non-scalar) fields", async () => {
    const result = await reconcileSchemaWith(deps());
    expect(result.added).not.toContain("SemanticUnit.representation");
  });

  it("reports a missing table instead of creating it", async () => {
    const ghost: ReconcilerModel = {
      name: "GhostTable",
      dbName: null,
      fields: [{ name: "id", kind: "scalar", type: "String", isRequired: true, hasDefaultValue: false }],
    };
    const result = await reconcileSchemaWith({ ...deps(), models: [ghost] });
    expect(result.missingTables).toContain("GhostTable");
    expect(result.added).toEqual([]);
  });
});

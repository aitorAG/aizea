// LanceDbVectorStore — implementación de `IVectorStore` sobre
// `@lancedb/lancedb`.
//
// Antes vivía en `lib/domain/rag/VectorStore.ts`. La Fase 1 (purificación del
// dominio) lo movió a infraestructura: es un adaptador puro sobre lancedb y no
// tiene lógica de dominio. El contrato lo expone `IVectorStore`.

import * as lancedb from "@lancedb/lancedb";
import type {
  IVectorStore,
  SearchResult,
  VectorRecord,
} from "@/lib/application/ports/vector-store.port";

export type { SearchResult, VectorRecord };

export class LanceDbVectorStore implements IVectorStore {
  private db: Promise<lancedb.Connection>;
  private tableName: string;
  private dimension: number;
  private table: lancedb.Table | null = null;

  constructor(options: {
    uri?: string;
    tableName?: string;
    dimension?: number;
  }) {
    // In-memory for tests ("memory://"), file-based for prod
    const uri = options.uri ?? "./lancedb-data";
    this.db = lancedb.connect(uri);
    this.tableName = options.tableName ?? "vectors";
    this.dimension = options.dimension ?? 1536;
  }

  private async getTable(): Promise<lancedb.Table> {
    if (this.table) {
      return this.table;
    }

    const db = await this.db;

    try {
      this.table = await db.openTable(this.tableName);
    } catch {
      // Table does not exist yet; create it with a dummy record so LanceDB
      // infers the schema correctly.
      this.table = await db.createTable(this.tableName, [
        {
          id: "__init__",
          vector: new Array(this.dimension).fill(0),
          metadata: "{}",
        },
      ]);
    }

    return this.table;
  }

  /**
   * Insert vectors into the store.
   */
  async insert(records: VectorRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }

    const table = await this.getTable();

    const rows = records.map((r) => ({
      id: r.id,
      vector: r.vector,
      metadata: JSON.stringify(r.metadata),
    }));

    await table.add(rows);
  }

  /**
   * Search for the top-K most similar vectors to the query vector.
   */
  async search(queryVector: number[], topK: number): Promise<SearchResult[]> {
    const table = await this.getTable();

    const results = await table
      .query()
      .nearestTo(queryVector)
      .limit(topK)
      .toArray();

    return results.map((row: Record<string, unknown>) => ({
      id: String(row.id),
      metadata: JSON.parse(String(row.metadata ?? "{}")),
      score: Number(row._distance ?? row.distance ?? 0),
    }));
  }

  /**
   * Remove all vectors whose metadata.materialId matches the given id.
   *
   * Fase 2.6 — pushdown del filtro al motor LanceDB/DataFusion. Antes esto
   * hacía `table.query().toArray()` (full-scan que cargaba TODAS las filas en
   * la memoria del proceso Node, parseaba cada `metadata` JSON en JS y filtraba
   * en el cliente) — O(n) en memoria/CPU del proceso por cada borrado.
   *
   * Ahora el predicado se evalúa dentro del motor: `metadata` se persiste como
   * `JSON.stringify(...)`, de modo que la subcadena `"materialId":"<id>"`
   * identifica de forma fiable las filas del material. `materialId` es un UUID
   * (solo `[0-9a-f-]`), sin comillas ni comodines, por lo que no necesita
   * escape en el literal SQL. No requiere columna nueva ni migración: funciona
   * sobre las tablas existentes (la columna `metadata` ya está presente).
   */
  async deleteByMaterialId(materialId: string): Promise<void> {
    const table = await this.getTable();
    const predicate = `metadata LIKE '%"materialId":"${materialId}"%'`;
    await table.delete(predicate);
  }
}

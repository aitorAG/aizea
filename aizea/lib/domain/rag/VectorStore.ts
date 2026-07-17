import * as lancedb from "@lancedb/lancedb";

export interface VectorRecord {
  id: string;
  vector: number[];
  metadata: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  metadata: Record<string, unknown>;
  score: number;
}

export class VectorStore {
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
   * LanceDB JS supports delete via SQL predicate.
   */
  async deleteByMaterialId(materialId: string): Promise<void> {
    const table = await this.getTable();
    const all = await table.query().toArray();

    const toDelete = all
      .filter((row: Record<string, unknown>) => {
        const meta = JSON.parse(String(row.metadata ?? "{}"));
        return meta.materialId === materialId;
      })
      .map((row: Record<string, unknown>) => String(row.id));

    if (toDelete.length === 0) {
      return;
    }

    const predicate = `id IN (${toDelete.map((id) => `'${id}'`).join(", ")})`;
    await table.delete(predicate);
  }
}

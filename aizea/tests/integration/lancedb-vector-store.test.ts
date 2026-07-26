import { describe, it, expect } from "vitest";
import { LanceDbVectorStore } from "@/lib/infrastructure/rag/lancedb-vector-store";
import type { VectorRecord } from "@/lib/application/ports/vector-store.port";

// Integración dedicada para LanceDbVectorStore (antes SIN test propio: el
// rag-engine.test.ts usa un vector store mock). Ejercita el adaptador real
// sobre una tabla lancedb en memoria ("memory://"), cubriendo el fix 2.6:
// `deleteByMaterialId` empuja el filtro al motor (predicado SQL sobre la
// columna `metadata`) en lugar de un full-scan en memoria de Node.

const DIM = 8;

function vec(seed: number): number[] {
  return Array.from({ length: DIM }, (_, i) => (seed + i) / 100);
}

function makeRecords(materialId: string, count: number): VectorRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${materialId}-${i}`,
    vector: vec(i + 1),
    metadata: { materialId, chunkIndex: i, content: `chunk ${i} of ${materialId}` },
  }));
}

/** Fresh in-memory store with a unique table name per test (isolation). */
function makeStore(tableName: string): LanceDbVectorStore {
  return new LanceDbVectorStore({
    uri: "memory://",
    tableName,
    dimension: DIM,
  });
}

describe("LanceDbVectorStore (integration, in-memory)", () => {
  it("insert + search returns the nearest inserted vectors", async () => {
    const store = makeStore(`t_search_${Date.now()}`);
    await store.insert(makeRecords("mat-a", 3));

    const results = await store.search(vec(1), 3);
    // The init dummy row + our rows may coexist; assert our ids are findable.
    const ids = results.map((r) => r.id);
    expect(ids.some((id) => id.startsWith("mat-a-"))).toBe(true);
    // Metadata round-trips through JSON.
    const mine = results.find((r) => r.id.startsWith("mat-a-"));
    expect(mine?.metadata.materialId).toBe("mat-a");
  });

  it("deleteByMaterialId removes ONLY the target material's vectors (pushdown)", async () => {
    const store = makeStore(`t_delete_${Date.now()}`);
    await store.insert(makeRecords("11111111-1111-1111-1111-111111111111", 4));
    await store.insert(makeRecords("22222222-2222-2222-2222-222222222222", 3));

    await store.deleteByMaterialId("11111111-1111-1111-1111-111111111111");

    // Search a large topK and confirm no vector from the deleted material
    // survives, while the other material's vectors remain.
    const results = await store.search(vec(1), 50);
    const survivingMaterialIds = results
      .map((r) => r.metadata.materialId)
      .filter((m): m is string => typeof m === "string");

    expect(survivingMaterialIds).not.toContain(
      "11111111-1111-1111-1111-111111111111"
    );
    expect(survivingMaterialIds).toContain(
      "22222222-2222-2222-2222-222222222222"
    );
  });

  it("deleteByMaterialId on an absent material is a safe no-op", async () => {
    const store = makeStore(`t_noop_${Date.now()}`);
    await store.insert(makeRecords("33333333-3333-3333-3333-333333333333", 2));

    await expect(
      store.deleteByMaterialId("99999999-9999-9999-9999-999999999999")
    ).resolves.toBeUndefined();

    // The existing material's vectors are untouched.
    const results = await store.search(vec(1), 50);
    const ids = results
      .map((r) => r.metadata.materialId)
      .filter((m): m is string => typeof m === "string");
    expect(ids).toContain("33333333-3333-3333-3333-333333333333");
  });
});

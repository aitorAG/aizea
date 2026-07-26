// Puerto del almacén vectorial que necesita RAGEngine.
//
// `VectorStore` era un adaptador de infraestructura puro (envoltorio sobre
// `@lancedb/lancedb`) que vivía en `lib/domain/rag/`. La Fase 1 (purificación
// del dominio) lo mueve a `lib/infrastructure/rag/lancedb-vector-store.ts` y
// deja aquí el contrato, para que `RAGEngine` NO importe lancedb directamente
// (gate: cero imports de infra en domain/).

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

export interface IVectorStore {
  /** Inserta vectores en el almacén. */
  insert(records: VectorRecord[]): Promise<void>;

  /** Busca los top-K vectores más similares al vector de consulta. */
  search(queryVector: number[], topK: number): Promise<SearchResult[]>;

  /** Elimina todos los vectores cuyo `metadata.materialId` coincida. */
  deleteByMaterialId(materialId: string): Promise<void>;
}

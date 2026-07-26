// Factory de infraestructura para RAGEngine.
//
// Ensambla `RAGEngine` (dominio, puro) con sus adaptadores de infraestructura:
// el almacén vectorial lancedb (`LanceDbVectorStore`) y el repositorio Prisma
// (`PrismaRagRepository`). Preserva la lógica test/prod del URI de lancedb que
// antes vivía dentro del constructor de RAGEngine.
//
// Extraído en la Fase 1 (purificación del dominio): los servicios de
// aplicación y el composition root usan este factory en vez de `new RAGEngine()`
// para no acoplar `RAGEngine` a lancedb/Prisma.

import { RAGEngine } from "@/lib/domain/rag/RAGEngine";
import { EmbeddingService } from "@/lib/infrastructure/ai/embedding-service";
import { LanceDbVectorStore } from "@/lib/infrastructure/rag/lancedb-vector-store";
import { PrismaRagRepository } from "@/lib/infrastructure/persistence/prisma-rag.repository";
import { getLanceDbDir } from "@/lib/paths";

/** Construye un RAGEngine listo para producción (lancedb + Prisma). */
export function createRAGEngine(): RAGEngine {
  const embedder = new EmbeddingService();
  const vectorStore = new LanceDbVectorStore({
    uri: process.env.NODE_ENV === "test" ? "memory://" : getLanceDbDir(),
    tableName: "material_chunks",
    dimension: embedder.dimension,
  });
  return new RAGEngine({
    embedder,
    vectorStore,
    repository: new PrismaRagRepository(),
  });
}

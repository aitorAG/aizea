// Puerto del repositorio que necesita RAGEngine.
//
// Encapsula las operaciones Prisma que el motor RAG usa al indexar un material
// (leer su contenido + reemplazar atómicamente sus TextChunks), para que
// `RAGEngine` NO importe Prisma (`@/lib/db`) directamente (gate de Fase 1:
// cero imports de infra en domain/). La implementación Prisma vive en
// `lib/infrastructure/persistence/prisma-rag.repository.ts`.

/** Datos para persistir un TextChunk. */
export interface TextChunkInput {
  materialId: string;
  chunkIndex: number;
  content: string;
  /** Embedding JSON-codificado. */
  embedding: string;
  tokenCount: number;
}

export interface IRagRepository {
  /** Contenido del material, o null si no existe. */
  findMaterialContent(materialId: string): Promise<string | null>;

  /** Reemplaza atómicamente los TextChunks del material (borra + crea). */
  replaceChunks(materialId: string, chunks: TextChunkInput[]): Promise<void>;
}

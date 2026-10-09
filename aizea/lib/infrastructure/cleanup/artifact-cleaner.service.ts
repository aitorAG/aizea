// ArtifactCleanerService — adaptador de infraestructura del puerto
// `ICourseArtifactCleaner`.
//
// Único lugar que sabe cómo tocar físicamente los artefactos de un curso:
//   - Vectores: `LanceDbVectorStore` con la MISMA configuración que usa
//     `rag-engine.factory` (memory:// en test, getLanceDbDir() en prod) para
//     que la limpieza apunte a la misma tabla que el indexado.
//   - Ficheros: unlink sobre <uploads>/ y <uploads>/figures/ respetando
//     AIZEA_DATA_DIR (desktop) — ver lib/paths.ts.
//
// Todos los métodos son tolerantes a "no existe": un artefacto ya ausente es
// un resultado de limpieza exitoso, no un error.

import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { LanceDbVectorStore } from "@/lib/infrastructure/rag/lancedb-vector-store";
import { EmbeddingService } from "@/lib/infrastructure/ai/embedding-service";
import { getLanceDbDir, getUploadsDir } from "@/lib/paths";
import type { ICourseArtifactCleaner } from "@/lib/application/ports/course-artifact-cleaner.port";

export interface ArtifactCleanerServiceOptions {
  /** Override del almacén vectorial (tests inyectan un fake). */
  vectorStore?: Pick<
    LanceDbVectorStore,
    "deleteByMaterialId"
  >;
  /** Override del directorio de uploads (tests). */
  uploadsDir?: string;
}

export class ArtifactCleanerService implements ICourseArtifactCleaner {
  private readonly uploadsDir: string;
  /**
   * Vector store PEREZOSO. NO se construye en el constructor: el singleton
   * `container` se instancia al importar el módulo, y construir aquí
   * LanceDB/EmbeddingService añadiría side-effects de import innecesarios.
   * Se crea solo en la primera llamada real a `deleteMaterialVectors`.
   */
  private lazyVectorStore:
    | Pick<LanceDbVectorStore, "deleteByMaterialId">
    | undefined;

  constructor(options: ArtifactCleanerServiceOptions = {}) {
    this.uploadsDir = options.uploadsDir ?? getUploadsDir();
    if (options.vectorStore) {
      this.lazyVectorStore = options.vectorStore;
    }
  }

  private get vectorStore():
    | Pick<LanceDbVectorStore, "deleteByMaterialId">
    | undefined {
    if (!this.lazyVectorStore) {
      // En test el factory usa memoria; para limpieza también basta memory://
      // (la tabla en memoria se descarta al terminar, así que delete es no-op).
      const embedder = new EmbeddingService();
      this.lazyVectorStore = new LanceDbVectorStore({
        uri: process.env.NODE_ENV === "test" ? "memory://" : getLanceDbDir(),
        tableName: "material_chunks",
        dimension: embedder.dimension,
      });
    }
    return this.lazyVectorStore;
  }

  async deleteMaterialVectors(materialId: string): Promise<void> {
    if (!this.vectorStore) return;
    await this.vectorStore.deleteByMaterialId(materialId);
  }

  async deleteUploadFile(filename: string): Promise<void> {
    await this.unlinkQuiet(join(this.uploadsDir, filename));
  }

  async deleteFigureFile(filename: string): Promise<void> {
    await this.unlinkQuiet(join(this.uploadsDir, "figures", filename));
  }

  /** unlink tolerante a "no existe": un artefacto ya ausente es éxito.
   *  Otros errores (permisos, EBUSY…) se propagan para que el orquestador
   *  decida (loguear y continuar con el resto de la limpieza). */
  private async unlinkQuiet(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: unknown }).code === "ENOENT"
      ) {
        return; // ya ausente → ok
      }
      throw err;
    }
  }
}

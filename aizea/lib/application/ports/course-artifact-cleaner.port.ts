// Puerto de limpieza de artefactos físicos asociados a un curso.
//
// Borrar un curso/material en BD deja huérfanos tres tipos de artefactos si
// nadie los elimina explícitamente:
//   1. Vectores LanceDB indexados por material (contaminan búsquedas RAG).
//   2. El PDF original subido a <uploads>/.
//   3. Las imágenes de figuras extraídas a <uploads>/figures/.
//
// La capa de aplicación orquesta el borrado a través de este puerto sin
// conocer fs ni LanceDB. TODAS las operaciones son best-effort desde el punto
// de vista del orquestador: la BD es la fuente de verdad y un fallo de
// limpieza física nunca debe impedir el borrado lógico.

export interface ICourseArtifactCleaner {
  /** Elimina los vectores LanceDB indexados para un material. */
  deleteMaterialVectors(materialId: string): Promise<void>;
  /** Elimina el PDF subido con el nombre dado de <uploads>/. */
  deleteUploadFile(filename: string): Promise<void>;
  /** Elimina la imagen de figura con el nombre dado de <uploads>/figures/. */
  deleteFigureFile(filename: string): Promise<void>;
}

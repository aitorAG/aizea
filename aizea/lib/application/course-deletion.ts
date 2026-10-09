// CourseDeletion — orquestador del borrado completo de un curso.
//
// El borrado lógico (filas BD con cascade) es la fuente de verdad y SIEMPRE
// se ejecuta. La limpieza física de artefactos es best-effort: un fallo
// borrando vectores o ficheros se loguea y no aborta la operación.
//
// Orden deliberado:
//   1. Leer artefactos (materiales + figuras) ANTES de borrar filas.
//   2. Vectores LanceDB por material (best-effort) — hacerlo antes del
//      cascade evita depender de IDs ya inexistentes si algo falla a mitad.
//   3. deleteCourseRow (cascade: materials, slides, figures, jobs, chunks…).
//   4. Ficheros PDF + imágenes de figuras (best-effort, por nombre).

import type { ICourseArtifactCleaner } from "@/lib/application/ports/course-artifact-cleaner.port";

export interface CourseArtifacts {
  materials: Array<{ id: string; filename: string }>;
  figures: Array<{ filename: string }>;
}

export interface CourseDeletionDeps {
  /** Carga los artefactos físicos asociados al curso. null = curso no existe. */
  loadArtifacts(courseId: string): Promise<CourseArtifacts | null>;
  /** Borra la fila Course (cascade elimina las filas dependientes). */
  deleteCourseRow(courseId: string): Promise<void>;
  /** Limpieza física (vectores + ficheros). */
  cleaner: ICourseArtifactCleaner;
}

/** Envuelve una operación best-effort: nunca lanza, solo loguea. */
async function bestEffort(step: string, op: () => Promise<void>): Promise<void> {
  try {
    await op();
  } catch (err) {
    console.warn(
      `[CourseDeletion] limpieza best-effort falló (${step}):`,
      err instanceof Error ? err.message : err
    );
  }
}

export function createDeleteCourse(
  deps: CourseDeletionDeps
): (courseId: string) => Promise<void> {
  return async function deleteCourse(courseId: string): Promise<void> {
    // 1. Artefactos antes del cascade (necesitamos filenames/ids).
    const artifacts = await deps.loadArtifacts(courseId);
    if (!artifacts) return; // curso inexistente → no-op silencioso

    // 2. Vectores por material (best-effort).
    for (const material of artifacts.materials) {
      await bestEffort(`vectors:${material.id}`, () =>
        deps.cleaner.deleteMaterialVectors(material.id)
      );
    }

    // 3. Borrado lógico (cascade). Este SÍ puede lanzar: si la BD falla,
    //    el usuario debe ver el error y las filas siguen ahí.
    await deps.deleteCourseRow(courseId);

    // 4. Ficheros físicos (best-effort).
    for (const material of artifacts.materials) {
      await bestEffort(`upload:${material.filename}`, () =>
        deps.cleaner.deleteUploadFile(material.filename)
      );
    }
    for (const figure of artifacts.figures) {
      await bestEffort(`figure:${figure.filename}`, () =>
        deps.cleaner.deleteFigureFile(figure.filename)
      );
    }
  };
}

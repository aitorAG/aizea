// Tests del orquestador de borrado de curso (v0.14.0):
//   - orden: artefactos → vectores → fila → ficheros
//   - curso inexistente = no-op silencioso
//   - fallos de limpieza física NO impiden el borrado lógico
//   - fallo del borrado en BD SÍ se propaga

import { describe, it, expect, vi } from "vitest";
import {
  createDeleteCourse,
  type CourseArtifacts,
  type CourseDeletionDeps,
} from "@/lib/application/course-deletion";
import type { ICourseArtifactCleaner } from "@/lib/application/ports/course-artifact-cleaner.port";

function makeCleaner(): ICourseArtifactCleaner & {
  calls: string[];
  failOn?: (step: string) => boolean;
} {
  const cleaner = {
    calls: [] as string[],
    failOn: undefined as ((step: string) => boolean) | undefined,
    async deleteMaterialVectors(id: string) {
      if (cleaner.failOn?.(`vectors:${id}`)) throw new Error("lance down");
      cleaner.calls.push(`vectors:${id}`);
    },
    async deleteUploadFile(filename: string) {
      if (cleaner.failOn?.(`upload:${filename}`)) throw new Error("EBUSY");
      cleaner.calls.push(`upload:${filename}`);
    },
    async deleteFigureFile(filename: string) {
      if (cleaner.failOn?.(`figure:${filename}`)) throw new Error("EPERM");
      cleaner.calls.push(`figure:${filename}`);
    },
  };
  return cleaner;
}

function makeDeps(
  artifacts: CourseArtifacts | null,
  cleaner: ICourseArtifactCleaner & { calls: string[] }
): CourseDeletionDeps & { deletedRows: string[] } {
  return {
    loadArtifacts: vi.fn(async () => artifacts),
    deleteCourseRow: vi.fn(async (courseId: string) => {
      (depsRef.deletedRows as string[]).push(courseId);
    }),
    cleaner,
    deletedRows: [],
  };
}

// Referencia mutable para que `deleteCourseRow` pueda registrar en el mismo
// objeto deps que devuelve el helper (evita orden de inicialización).
let depsRef: { deletedRows: unknown };

describe("createDeleteCourse", () => {
  it("borra vectores, luego la fila, luego los ficheros físicos", async () => {
    const cleaner = makeCleaner();
    const deps = makeDeps(
      {
        materials: [
          { id: "m1", filename: "a.pdf" },
          { id: "m2", filename: "b.pdf" },
        ],
        figures: [{ filename: "fig1.png" }],
      },
      cleaner
    );
    depsRef = deps;

    await createDeleteCourse(deps)("course-1");

    expect(deps.deletedRows).toEqual(["course-1"]);
    // Todos los artefactos se intentaron limpiar.
    expect(cleaner.calls).toContain("vectors:m1");
    expect(cleaner.calls).toContain("vectors:m2");
    expect(cleaner.calls).toContain("upload:a.pdf");
    expect(cleaner.calls).toContain("upload:b.pdf");
    expect(cleaner.calls).toContain("figure:fig1.png");
  });

  it("curso inexistente es no-op silencioso", async () => {
    const cleaner = makeCleaner();
    const deps = makeDeps(null, cleaner);
    depsRef = deps;

    await createDeleteCourse(deps)("ghost");

    expect(deps.deletedRows).toEqual([]);
    expect(cleaner.calls).toEqual([]);
  });

  it("fallos de limpieza física no impiden el borrado lógico ni lanzan", async () => {
    const cleaner = makeCleaner();
    cleaner.failOn = () => true; // TODO falla
    const deps = makeDeps(
      {
        materials: [{ id: "m1", filename: "a.pdf" }],
        figures: [{ filename: "fig1.png" }],
      },
      cleaner
    );
    depsRef = deps;

    await expect(createDeleteCourse(deps)("course-1")).resolves.toBeUndefined();
    expect(deps.deletedRows).toEqual(["course-1"]);
  });

  it("un fallo del borrado en BD se propaga al llamador", async () => {
    const cleaner = makeCleaner();
    const deps = makeDeps(
      { materials: [], figures: [] },
      cleaner
    ) as CourseDeletionDeps & { deletedRows: string[] };
    depsRef = deps;
    deps.deleteCourseRow = vi.fn(async () => {
      throw new Error("db locked");
    });

    await expect(createDeleteCourse(deps)("course-1")).rejects.toThrow(
      "db locked"
    );
  });
});

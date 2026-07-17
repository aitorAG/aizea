// PrismaMaterialRepository — Prisma + filesystem implementation of
// `IMaterialRepository`.
//
// Persistence layout:
//   - The Prisma `Material` row stores extracted text + page count.
//   - The original PDF bytes live on disk under `public/uploads/{filename}`.
//
// The repository owns BOTH responsibilities (database + filesystem)
// so the use cases never touch `db.material` or `fs` directly. This
// is the seam that lets the "Generar árbol" use case re-read the
// bytes from disk and feed them back into the pipeline when the
// original segmentation failed (e.g. docling-serve was down at
// upload time) — without that seam, the action layer would have to
// reach into the filesystem on its own, which is the symptom-patch
// path this refactor explicitly removes.

import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { db } from "@/lib/db";
import {
  type CreateMaterialInput,
  type IMaterialRepository,
  type Material,
} from "@/lib/application/ports/material-repository.port";
import { materialFromRow } from "@/lib/domain/entities/material";

export interface PrismaMaterialRepositoryOptions {
  /** Override the uploads directory. Tests can point this at a
   *  `tmp/` dir so the test never touches the real `public/uploads`. */
  uploadsDir?: string;
}

/** Resolve the on-disk location of a material's original bytes. */
function defaultUploadsDir(): string {
  return join(process.cwd(), "public", "uploads");
}

export class PrismaMaterialRepository implements IMaterialRepository {
  private readonly uploadsDir: string;

  constructor(options: PrismaMaterialRepositoryOptions = {}) {
    this.uploadsDir = options.uploadsDir ?? defaultUploadsDir();
  }

  async findById(id: string): Promise<Material | null> {
    const row = await db.material.findUnique({ where: { id } });
    return row ? materialFromRow(row) : null;
  }

  async findByCourseId(courseId: string): Promise<Material[]> {
    const rows = await db.material.findMany({
      where: { courseId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(materialFromRow);
  }

  async hasProcessedUnits(materialId: string): Promise<boolean> {
    // A "processed" material is one whose segmenter has produced at
    // least one SemanticUnit row. We use a count with `take: 1`
    // instead of `count()` so the DB can short-circuit.
    const unit = await db.semanticUnit.findFirst({
      where: { materialId },
      select: { id: true },
    });
    return unit !== null;
  }

  async readBuffer(materialId: string): Promise<Buffer | null> {
    const material = await db.material.findUnique({
      where: { id: materialId },
      select: { filename: true },
    });
    if (!material) return null;
    return this.readFileFromDisk(material.filename);
  }

  /**
   * Read a previously-persisted file from the uploads directory.
   * Returns null if the file is missing (e.g. someone wiped the
   * directory) so the use case can surface FILE_MISSING.
   */
  private async readFileFromDisk(filename: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.uploadsDir, filename));
    } catch (err) {
      console.warn(
        `[PrismaMaterialRepository] readFile(${filename}) failed:`,
        err instanceof Error ? err.message : err
      );
      return null;
    }
  }

  async create(data: CreateMaterialInput): Promise<Material> {
    // Persist the original file to disk so the "Generar árbol" use
    // case can re-read it later. Failures are non-fatal: the row is
    // already going to be created and the text content is already
    // available on the row. We log and continue.
    try {
      await mkdir(this.uploadsDir, { recursive: true });
      await writeFile(join(this.uploadsDir, data.filename), data.buffer);
    } catch (err) {
      console.warn(
        `[PrismaMaterialRepository] Failed to persist file ${data.filename}:`,
        err instanceof Error ? err.message : err
      );
    }

    const row = await db.material.create({
      data: {
        courseId: data.courseId,
        filename: data.filename,
        content: data.content,
        pageCount: data.pageCount,
        fileSize: data.fileSize,
        fileType: data.fileType,
      },
    });
    return materialFromRow(row);
  }
}

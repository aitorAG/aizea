// FsFigureStore — implementación de `IFigureStore` que escribe los ficheros de
// imagen en disco (bajo el directorio de uploads/figures) y persiste la fila
// Figure vía Prisma.
//
// Único lugar que conoce el sistema de ficheros y Prisma para las figuras.
// Extraído en la Fase 1 (purificación del dominio) para que `FigureExtractor`
// no importe `node:fs`, `@/lib/paths` ni `@/lib/db`.

import { db } from "@/lib/db";
import fs from "node:fs/promises";
import path from "node:path";
import { getUploadsDir } from "@/lib/paths";
import type {
  FigureToSave,
  IFigureStore,
  SavedFigure,
} from "@/lib/application/ports/figure-store.port";

export class FsFigureStore implements IFigureStore {
  private readonly figuresDir: string;

  constructor(figuresDir?: string) {
    // Store figures alongside uploads in the data dir so they survive in the
    // writable location on desktop (.exe/.msi) installs.
    this.figuresDir = figuresDir ?? path.join(getUploadsDir(), "figures");
  }

  async writeImage(filename: string, data: Buffer): Promise<void> {
    const filePath = path.join(this.figuresDir, filename);
    await fs.mkdir(this.figuresDir, { recursive: true });
    await fs.writeFile(filePath, data);
  }

  async readImage(filename: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(path.join(this.figuresDir, filename));
    } catch {
      return null; // missing/unreadable → caller skips the figure slide
    }
  }

  async createFigure(data: FigureToSave): Promise<SavedFigure> {
    const row = await db.figure.create({
      data: {
        courseId: data.courseId,
        filename: data.filename,
        caption: data.caption,
        pageNum: data.pageNum,
      },
    });
    return {
      id: row.id,
      filename: row.filename,
      caption: row.caption,
      pageNum: row.pageNum,
    };
  }
}

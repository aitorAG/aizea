import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * SlideCrudService — responsabilidad ÚNICA: CRUD y reordenación de
 * diapositivas (Slide).
 *
 * Extraído de `SlideService` (fichero-dios con 6 responsabilidades) como
 * parte de la Fase 1 del plan de reescritura selectiva (CA-7). CRUD puro
 * sobre Prisma; no toca LLM ni RAG ni el árbol de conceptos.
 */
export class SlideCrudService {
  constructor(private database: PrismaClient = db) {}

  /** Crea una diapositiva manual al final de la lista del curso. */
  async createSlide(courseId: string, title: string, description: string) {
    const maxOrder = await this.database.slide.findFirst({
      where: { courseId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    return this.database.slide.create({
      data: {
        courseId,
        title,
        description,
        order: (maxOrder?.order ?? -1) + 1,
      },
    });
  }

  /** Actualiza campos editables de una diapositiva. */
  async updateSlide(
    slideId: string,
    data: { title?: string; description?: string; htmlDesign?: string }
  ) {
    return this.database.slide.update({
      where: { id: slideId },
      data,
    });
  }

  /** Borra una diapositiva; lanza si no existe. */
  async deleteSlide(slideId: string) {
    const slide = await this.database.slide.findUnique({
      where: { id: slideId },
    });
    if (!slide) throw new Error("Diapositiva no encontrada");

    await this.database.slide.delete({ where: { id: slideId } });
  }

  /** Reasigna el campo `order` de las diapositivas según el orden dado. */
  async reorderSlides(courseId: string, slideIds: string[]): Promise<void> {
    const updates = slideIds.map((id, index) =>
      this.database.slide.update({
        where: { id },
        data: { order: index },
      })
    );
    await Promise.all(updates);
  }
}

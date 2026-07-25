import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { BoxType, type GeneratedBoxes } from "@/lib/types";

/**
 * SlideBoxService — responsabilidad ÚNICA: el ciclo de vida de las cajas de
 * contenido de una diapositiva (SlideBox).
 *
 * Extraído de `SlideService` (que era un fichero-dios con 6 responsabilidades)
 * como parte de la Fase 1 del plan de reescritura selectiva (CA-7: sin
 * ficheros-dios; una responsabilidad por módulo).
 *
 * Es un servicio de aplicación de CRUD puro sobre Prisma; no toca LLM ni RAG.
 * `SlideService.generateSlideContent` lo usa para persistir las cajas que
 * genera la IA, y las server actions de cajas (`lib/actions/box.ts`) lo
 * consumen directamente.
 */
export class SlideBoxService {
  constructor(private database: PrismaClient = db) {}

  /** Actualiza el contenido de una caja concreta. */
  async updateBox(boxId: string, content: string) {
    return this.database.slideBox.update({
      where: { id: boxId },
      data: { content },
    });
  }

  /** Devuelve todas las cajas de una diapositiva. */
  async getBoxesForSlide(slideId: string) {
    return this.database.slideBox.findMany({
      where: { slideId },
    });
  }

  /**
   * Reemplaza el conjunto de cajas de una diapositiva por las cinco cajas
   * canónicas (guion, relevancia, narrativa, ejercicio 1, ejercicio 2).
   * Borra las existentes primero para que la operación sea idempotente.
   */
  async initializeBoxesForSlide(slideId: string, boxes: GeneratedBoxes) {
    await this.database.slideBox.deleteMany({ where: { slideId } });

    const boxTypes = [
      { type: BoxType.SCRIPT, content: boxes.script },
      { type: BoxType.RELEVANCE, content: boxes.relevance },
      { type: BoxType.NARRATIVE, content: boxes.narrative },
      { type: BoxType.EXERCISE_1, content: boxes.exercise1 },
      { type: BoxType.EXERCISE_2, content: boxes.exercise2 },
    ];

    await this.database.slideBox.createMany({
      data: boxTypes.map((b) => ({
        slideId,
        type: b.type,
        content: b.content,
      })),
    });
  }
}

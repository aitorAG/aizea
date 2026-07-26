"use server";

import { container } from "@/lib/composition/container";
import { extractFigureReferences } from "@/lib/domain/figures/figure-references";
import { FigureExtractor } from "@/lib/domain/figures/FigureExtractor";
import { FsFigureStore } from "@/lib/infrastructure/figures/figure-store";
import { revalidatePath } from "next/cache";
import { ValidationError } from "@/lib/actions/_action-error";

const figureExtractor = new FigureExtractor(undefined, new FsFigureStore());

export async function extractFigureRefs(
  courseId: string
): Promise<{ count: number }> {
  const materials = await container.materials.findByCourseId(courseId);

  if (materials.length === 0) {
    throw new ValidationError("No hay materiales subidos. Sube un PDF primero.");
  }

  const combinedText = materials.map((m) => m.content).join("\n\n");
  const refs = extractFigureReferences(combinedText);

  if (refs.length === 0) {
    throw new ValidationError(
      "No se encontraron referencias a figuras en el material."
    );
  }

  const figures = refs.map((ref) => ({
    courseId,
    filename: "",
    caption: ref.caption,
    pageNum: ref.pageNum,
    tags: JSON.stringify(["pendiente"]),
  }));

  // replaceAllForCourse wraps delete + create in a transaction so the
  // course never has zero figures between the two operations.
  await container.figures.replaceAllForCourse(courseId, figures);

  revalidatePath(`/courses/${courseId}/figures`);
  return { count: figures.length };
}

export async function extractAndSave(
  buffer: Buffer,
  courseId: string
): Promise<{ count: number }> {
  const figures = await figureExtractor.extractAndSave(buffer, courseId);
  revalidatePath(`/courses/${courseId}/figures`);
  return { count: figures.length };
}

export async function updateFigure(
  figureId: string,
  data: { caption?: string; tags?: string[] }
) {
  const figure = await container.figures.update(figureId, {
    ...(data.caption !== undefined && { caption: data.caption }),
    ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
  });
  revalidatePath(`/courses/${figure.courseId}/figures`);
  return figure;
}

export async function getCourseFigures(courseId: string) {
  return container.figures.findByCourseId(courseId);
}

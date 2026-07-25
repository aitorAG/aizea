"use server";

import { db } from "@/lib/db";
import { extractFigureReferences } from "@/lib/domain/figures/figure-references";
import { FigureExtractor } from "@/lib/domain/figures/FigureExtractor";
import { revalidatePath } from "next/cache";
import { ValidationError } from "@/lib/actions/_action-error";

const figureExtractor = new FigureExtractor();

export async function extractFigureRefs(
  courseId: string
): Promise<{ count: number }> {
  const materials = await db.material.findMany({
    where: { courseId },
    orderBy: { createdAt: "desc" },
  });

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

  // Wrap delete + create in a transaction so the course never has zero
  // figures between the two operations.
  await db.$transaction([
    db.figure.deleteMany({ where: { courseId } }),
    db.figure.createMany({ data: figures }),
  ]);

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
  const figure = await db.figure.update({
    where: { id: figureId },
    data: {
      ...(data.caption !== undefined && { caption: data.caption }),
      ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
    },
  });
  revalidatePath(`/courses/${figure.courseId}/figures`);
  return figure;
}

export async function getCourseFigures(courseId: string) {
  return db.figure.findMany({
    where: { courseId },
    orderBy: { createdAt: "desc" },
  });
}

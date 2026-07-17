"use server";

import { db } from "@/lib/db";
import { SlideService } from "@/lib/application/SlideService";
import { revalidatePath } from "next/cache";
import { type GeneratedBoxes } from "@/lib/types";

const slideService = new SlideService();

export async function updateBox(boxId: string, content: string) {
  const box = await slideService.updateBox(boxId, content);
  const slide = await db.slide.findUnique({ where: { id: box.slideId } });
  if (slide) revalidatePath(`/courses/${slide.courseId}/slides/${slide.id}`);
  return box;
}

export async function getBoxesForSlide(slideId: string) {
  return slideService.getBoxesForSlide(slideId);
}

export async function initializeBoxesForSlide(
  slideId: string,
  boxes: GeneratedBoxes
) {
  await slideService.initializeBoxesForSlide(slideId, boxes);
  const slide = await db.slide.findUnique({ where: { id: slideId } });
  if (slide) revalidatePath(`/courses/${slide.courseId}/slides/${slideId}`);
}

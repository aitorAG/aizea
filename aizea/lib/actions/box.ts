"use server";

import { container } from "@/lib/composition/container";
import { SlideBoxService } from "@/lib/application/SlideBoxService";
import { revalidatePath } from "next/cache";
import { type GeneratedBoxes } from "@/lib/types";

const slideBoxService = new SlideBoxService();

export async function updateBox(boxId: string, content: string) {
  const box = await slideBoxService.updateBox(boxId, content);
  const row = await container.slides.findCourseIdById(box.slideId);
  if (row) revalidatePath(`/courses/${row.courseId}/slides/${box.slideId}`);
  return box;
}

export async function getBoxesForSlide(slideId: string) {
  return slideBoxService.getBoxesForSlide(slideId);
}

export async function initializeBoxesForSlide(
  slideId: string,
  boxes: GeneratedBoxes
) {
  await slideBoxService.initializeBoxesForSlide(slideId, boxes);
  const row = await container.slides.findCourseIdById(slideId);
  if (row) revalidatePath(`/courses/${row.courseId}/slides/${slideId}`);
}

"use server";

import { container } from "@/lib/composition/container";
import { SlideService } from "@/lib/application/SlideService";
import { revalidatePath } from "next/cache";
import { type GeneratedBoxes } from "@/lib/types";

const slideService = new SlideService();

export async function generateOutline(
  courseId: string,
  selectedNodeIds: string[]
): Promise<
  { id: string; title: string; description: string; order: number }[]
> {
  const slides = await slideService.generateOutlineFromTree(
    courseId,
    selectedNodeIds
  );
  revalidatePath(`/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}/slides`);
  return slides;
}

export async function generateSlideContent(
  slideId: string
): Promise<GeneratedBoxes> {
  const row = await container.slides.findCourseIdById(slideId);
  const result = await slideService.generateSlideContent(slideId);
  if (row) {
    revalidatePath(`/courses/${row.courseId}/slides/${slideId}`);
    revalidatePath(`/courses/${row.courseId}/slides`);
  }
  return result;
}

export async function regenerateHtmlDesign(
  slideId: string,
  designInstructions: string
): Promise<string> {
  const row = await container.slides.findCourseIdById(slideId);
  const result = await slideService.regenerateHtmlDesign(slideId, designInstructions);
  if (row) {
    revalidatePath(`/courses/${row.courseId}/slides/${slideId}`);
    revalidatePath(`/courses/${row.courseId}/slides`);
  }
  return result;
}

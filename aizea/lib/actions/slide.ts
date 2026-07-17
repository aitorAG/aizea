"use server";

import { db } from "@/lib/db";
import { SlideService } from "@/lib/application/SlideService";
import { revalidatePath } from "next/cache";

const slideService = new SlideService();

export async function createSlide(
  courseId: string,
  title: string,
  description: string
) {
  const slide = await slideService.createSlide(courseId, title, description);
  revalidatePath(`/courses/${courseId}`);
  return slide;
}

export async function updateSlide(
  slideId: string,
  data: { title?: string; description?: string; htmlDesign?: string }
) {
  const slide = await slideService.updateSlide(slideId, data);
  revalidatePath(`/courses/${slide.courseId}`);
  return slide;
}

export async function deleteSlide(slideId: string) {
  const slide = await db.slide.findUnique({ where: { id: slideId } });
  if (!slide) throw new Error("Diapositiva no encontrada");
  await slideService.deleteSlide(slideId);
  revalidatePath(`/courses/${slide.courseId}`);
}

export async function reorderSlides(courseId: string, slideIds: string[]) {
  await slideService.reorderSlides(courseId, slideIds);
  revalidatePath(`/courses/${courseId}`);
}

export async function addManualSlide(
  courseId: string,
  title: string,
  description: string
) {
  return createSlide(courseId, title, description);
}

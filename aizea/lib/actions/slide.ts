"use server";

import { container } from "@/lib/composition/container";
import { SlideService } from "@/lib/application/SlideService";
import { SlideCrudService } from "@/lib/application/SlideCrudService";
import { revalidatePath } from "next/cache";
import { NotFoundError } from "@/lib/actions/_action-error";

// CRUD puro de diapositivas.
const slideCrudService = new SlideCrudService();
// SlideService solo para createMinimalSlidesFromTree (responsabilidad árbol→slides,
// aún no extraída a caso de uso propio).
const slideService = new SlideService();

export async function createSlide(courseId: string, title: string, description: string) {
  const slide = await slideCrudService.createSlide(courseId, title, description);
  revalidatePath(`/courses/${courseId}`);
  return slide;
}

export async function updateSlide(
  slideId: string,
  data: { title?: string; description?: string; htmlDesign?: string }
) {
  const slide = await slideCrudService.updateSlide(slideId, data);
  revalidatePath(`/courses/${slide.courseId}`);
  return slide;
}

export async function deleteSlide(slideId: string) {
  const row = await container.slides.findCourseIdById(slideId);
  if (!row) throw new NotFoundError("Slide", slideId);
  await slideCrudService.deleteSlide(slideId);
  revalidatePath(`/courses/${row.courseId}`);
}

export async function reorderSlides(courseId: string, slideIds: string[]) {
  await slideCrudService.reorderSlides(courseId, slideIds);
  revalidatePath(`/courses/${courseId}`);
}

export async function addManualSlide(courseId: string, title: string, description: string) {
  return createSlide(courseId, title, description);
}

export async function createMinimalSlides(
  courseId: string,
  selectedNodeIds: string[]
): Promise<
  { id: string; courseId: string; title: string; description: string; order: number }[]
> {
  const created = await slideService.createMinimalSlidesFromTree(courseId, selectedNodeIds);
  revalidatePath(`/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}/slides`);
  return created;
}

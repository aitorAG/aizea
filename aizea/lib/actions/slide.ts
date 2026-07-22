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

/**
 * v1.9 / Issue 3+4 — Create a minimal slide skeleton (title +
 * description only) for each supplied TopicNode id. NO LLM call,
 * NO htmlDesign, NO SlideBox rows. The user is expected to drive
 * content generation from the slides page.
 *
 * Returns the list of newly-created slides. The caller (the tree
 * page) is responsible for showing the user-facing feedback (toast
 * + navigation) — this action is intentionally thin so it can be
 * reused from other surfaces (e.g. a future "Add to slides" button
 * in the tree node context menu) without taking on a UI contract.
 */
export async function createMinimalSlides(
  courseId: string,
  selectedNodeIds: string[]
): Promise<
  { id: string; courseId: string; title: string; description: string; order: number }[]
> {
  const created = await slideService.createMinimalSlidesFromTree(
    courseId,
    selectedNodeIds
  );
  // The slides list page is the primary surface the user lands on
  // after the action runs; revalidate BOTH `/courses/${id}` (the
  // overview shows a slide count) and `/courses/${id}/slides` (the
  // page they get navigated to) so the cached server payload
  // doesn't lag behind the write.
  revalidatePath(`/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}/slides`);
  return created;
}

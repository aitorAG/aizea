"use server";

import { db } from "@/lib/db";
import { SlideService } from "@/lib/application/SlideService";
import { JobQueue } from "@/lib/infrastructure/queue/JobQueue";
import { revalidatePath } from "next/cache";
import { type GeneratedBoxes } from "@/lib/types";

const slideService = new SlideService();
const jobQueue = new JobQueue();

/**
 * Generate a slide outline from a set of selected TopicNodes. The LLM
 * reorders the nodes into a pedagogically-sensible order; one slide is
 * created per node using `node.name` as title and `node.summary` as
 * description. Existing slides for the course are replaced.
 */
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
  await jobQueue.enqueue("generate-outline", { courseId, selectedNodeIds });
  revalidatePath(`/courses/${courseId}`);
  revalidatePath(`/courses/${courseId}/slides`);
  return slides;
}

export async function generateSlideContent(
  slideId: string
): Promise<GeneratedBoxes> {
  const slide = await db.slide.findUnique({
    where: { id: slideId },
    select: { courseId: true },
  });
  const result = await slideService.generateSlideContent(slideId);
  if (slide) {
    revalidatePath(`/courses/${slide.courseId}/slides/${slideId}`);
    // v1.5 / Auto-refresh — the slides list page derives `hasContent`
    // from the box count, so we also invalidate the list path. Without
    // this, the server returns stale `hasContent=false` rows even
    // though the boxes were just written, and the client has to
    // hard-reload to see the green "Listo" badge.
    revalidatePath(`/courses/${slide.courseId}/slides`);
  }
  return result;
}

export async function regenerateHtmlDesign(
  slideId: string,
  designInstructions: string
): Promise<string> {
  const slide = await db.slide.findUnique({
    where: { id: slideId },
    select: { courseId: true },
  });
  const result = await slideService.regenerateHtmlDesign(
    slideId,
    designInstructions
  );
  if (slide) {
    revalidatePath(`/courses/${slide.courseId}/slides/${slideId}`);
    revalidatePath(`/courses/${slide.courseId}/slides`);
  }
  return result;
}

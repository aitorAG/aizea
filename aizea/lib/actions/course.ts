"use server";

import { CourseService } from "@/lib/application/CourseService";
import { CourseSummary } from "@/lib/types";
import { revalidatePath } from "next/cache";

const courseService = new CourseService();

export async function createCourse(name: string): Promise<{ id: string }> {
  const course = await courseService.createCourse(name);
  revalidatePath("/");
  return { id: course.id };
}

export async function getCourses(): Promise<CourseSummary[]> {
  const courses = await courseService.listCourses();
  return courses.map((course) => ({
    id: course.id,
    name: course.name,
    slideCount: course._count.slides,
    materialCount: course._count.materials,
    updatedAt: course.updatedAt.toISOString(),
  }));
}

export async function getCourse(id: string): Promise<{
  course: { id: string; name: string; createdAt: Date; updatedAt: Date };
  slides: Array<{
    id: string;
    title: string;
    description: string;
    order: number;
    figureRefs: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  materials: Array<{
    id: string;
    filename: string;
    content: string;
    pageCount: number;
    createdAt: Date;
  }>;
  figures: Array<{
    id: string;
    filename: string;
    caption: string | null;
    pageNum: number | null;
    tags: string;
    createdAt: Date;
  }>;
}> {
  const course = await courseService.getCourse(id);
  const { slides, materials, figures, ...courseData } = course;

  return {
    course: courseData,
    slides: slides.map((slide) => ({
      id: slide.id,
      title: slide.title,
      description: slide.description,
      order: slide.order,
      figureRefs: slide.figureRefs,
      createdAt: slide.createdAt,
      updatedAt: slide.updatedAt,
    })),
    materials: materials.map((material) => ({
      id: material.id,
      filename: material.filename,
      content: material.content,
      pageCount: material.pageCount,
      createdAt: material.createdAt,
    })),
    figures: figures.map((figure) => ({
      id: figure.id,
      filename: figure.filename,
      caption: figure.caption,
      pageNum: figure.pageNum,
      tags: figure.tags,
      createdAt: figure.createdAt,
    })),
  };
}

export async function deleteCourse(id: string): Promise<void> {
  await courseService.deleteCourse(id);
  revalidatePath("/");
}

export async function updateCourseContext(
  id: string,
  llmContext: string
): Promise<void> {
  await courseService.updateCourse(id, { llmContext });
  revalidatePath(`/courses/${id}`);
  revalidatePath(`/courses/${id}/materials`);
}

export async function updateCourse(
  id: string,
  data: { name?: string; llmContext?: string }
) {
  const course = await courseService.updateCourse(id, data);
  revalidatePath("/");
  revalidatePath(`/courses/${id}`);
  return course;
}

/**
 * v1.0 — persist the "target slide count" slider (0-300). It's an orientative
 * granularity hint (not a hard cap): higher → more topics/slides. Consumed by
 * ConceptIntegrator (clustering threshold) and the tree agent.
 */
export async function updateSlideTarget(
  id: string,
  slideTarget: number | null
): Promise<void> {
  const clamped =
    slideTarget == null ? null : Math.max(0, Math.min(300, Math.round(slideTarget)));
  await courseService.updateCourse(id, { slideTarget: clamped });
  revalidatePath(`/courses/${id}/tree`);
}

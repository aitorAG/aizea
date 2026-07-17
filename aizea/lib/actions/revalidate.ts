"use server";
import { revalidatePath } from "next/cache";

export async function revalidateSlides(courseId: string) {
  revalidatePath(`/courses/${courseId}/slides`);
}

export async function revalidateSlide(courseId: string, slideId: string) {
  revalidatePath(`/courses/${courseId}/slides/${slideId}`);
}

export async function revalidateDashboard() {
  revalidatePath("/");
}

export async function revalidateMaterials(courseId: string) {
  revalidatePath(`/courses/${courseId}/materials`);
}

export async function revalidateCourse(courseId: string) {
  revalidatePath(`/courses/${courseId}`);
}

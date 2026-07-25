"use server";

import { db } from "@/lib/db";
import { container } from "@/lib/composition/container";
import { revalidatePath } from "next/cache";
import { NotFoundError, ValidationError } from "@/lib/actions/_action-error";

export async function uploadMaterial(
  courseId: string,
  formData: FormData
): Promise<{ id: string; content: string; filename: string }> {
  const file = formData.get("file") as File | null;
  if (!file) {
    throw new ValidationError("No se proporcionó ningún archivo");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = `${Date.now()}_${file.name}`;

  const { material } = await container.uploadMaterial.execute({
    courseId,
    filename,
    fileType:
      file.type || file.name.split(".").pop()?.toLowerCase() || null,
    fileSize: file.size,
    buffer,
    userId: "default",
  });

  revalidatePath(`/courses/${courseId}/materials`);
  revalidatePath(`/courses/${courseId}/tree`);
  revalidatePath(`/courses/${courseId}`);

  return {
    id: material.id,
    content: material.content,
    filename: material.filename,
  };
}

export async function getCourseMaterials(courseId: string) {
  return db.material.findMany({
    where: { courseId },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteMaterial(id: string): Promise<void> {
  const material = await db.material.findUnique({ where: { id } });
  if (!material) return;
  await db.$transaction([
    db.textChunk.deleteMany({ where: { materialId: id } }),
    db.material.delete({ where: { id } }),
  ]);
  revalidatePath(`/courses/${material.courseId}`);
  revalidatePath(`/courses/${material.courseId}/materials`);
}

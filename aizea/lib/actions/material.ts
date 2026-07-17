"use server";

// Server actions for materials.
//
// Thin adapters that delegate to the use case in
// `lib/application/use-cases/upload-material.use-case.ts`. The use
// case owns the upload side-effects (PDF text extraction, file
// persistence, RAG indexing, figure extraction, pipeline trigger),
// the action just translates HTTP / FormData into a use-case
// input and revalidates the affected pages.

import { db } from "@/lib/db";
import { container } from "@/lib/composition/container";
import { revalidatePath } from "next/cache";

export async function uploadMaterial(
  courseId: string,
  formData: FormData
): Promise<{ id: string; content: string; filename: string }> {
  const file = formData.get("file") as File | null;
  if (!file) {
    throw new Error("No se proporcionó ningún archivo");
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

  // ROOT-CAUSE FIX: revalidate the materials page AND the tree page.
  // The materials list must refresh (fix #1) and the tree page must
  // re-evaluate which pipeline jobs to surface. Without revalidating
  // /tree, the server component there would still show the old
  // `activeJob` lookup.
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
  // The repository handles vector store cleanup; for now we use the
  // raw DB so the existing flow is preserved. The repository's
  // readBuffer is used by the use case, not the delete path.
  await db.textChunk.deleteMany({ where: { materialId: id } });
  await db.material.delete({ where: { id } });
  revalidatePath(`/courses/${material.courseId}`);
  revalidatePath(`/courses/${material.courseId}/materials`);
}

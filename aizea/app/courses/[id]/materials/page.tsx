import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { MaterialsClient } from "./materials-client";

export const revalidate = 300;

interface MaterialsPageProps {
  params: Promise<{ id: string }>;
}

export interface MaterialItem {
  id: string;
  filename: string;
  fileSize: number | null;
  fileType: string | null;
  pageCount: number;
  createdAt: string;
}

export default async function MaterialsPage({ params }: MaterialsPageProps) {
  const { id } = await params;

  const course = await db.course.findUnique({
    where: { id },
    include: {
      materials: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!course) {
    notFound();
  }

  const materials: MaterialItem[] = course.materials.map((m) => ({
    id: m.id,
    filename: m.filename,
    fileSize: m.fileSize,
    fileType: m.fileType,
    pageCount: m.pageCount,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <MaterialsClient
      courseId={id}
      courseName={course.name}
      llmContext={course.llmContext ?? ""}
      materials={materials}
    />
  );
}
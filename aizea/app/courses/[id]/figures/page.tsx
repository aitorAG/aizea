import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { FigureGalleryClient } from "./figure-gallery-client";

interface FigureGalleryPageProps {
  params: Promise<{ id: string }>;
}

export default async function FigureGalleryPage({ params }: FigureGalleryPageProps) {
  const { id: courseId } = await params;

  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, name: true },
  });

  if (!course) {
    notFound();
  }

  const figures = await db.figure.findMany({
    where: { courseId },
    orderBy: { createdAt: "asc" },
  });

  const figureData = figures.map((f) => ({
    id: f.id,
    filename: f.filename,
    caption: f.caption,
    pageNum: f.pageNum,
    tags: JSON.parse(f.tags) as string[],
  }));

  return <FigureGalleryClient courseId={courseId} courseName={course.name} figures={figureData} />;
}
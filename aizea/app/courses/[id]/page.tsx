import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { CourseDetailClient } from "./course-detail-client";

interface CourseDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function CourseDetailPage({ params }: CourseDetailPageProps) {
  const { id } = await params;

  const course = await db.course.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      materials: { orderBy: { createdAt: "desc" }, select: { id: true, filename: true, pageCount: true, createdAt: true } },
      slides: { orderBy: { order: "asc" }, select: { id: true, title: true, description: true, order: true } },
      figures: { orderBy: { createdAt: "asc" }, select: { id: true, filename: true, caption: true, pageNum: true, tags: true } },
    },
  });

  if (!course) {
    notFound();
  }

  const slides: { id: string; title: string; description: string; order: number }[] =
    course.slides.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      order: s.order,
    }));

  const materials = course.materials.map((m) => ({
    id: m.id,
    filename: m.filename,
    pageCount: m.pageCount,
    createdAt: m.createdAt.toISOString(),
  }));

  const figures = course.figures.map((f) => ({
    id: f.id,
    filename: f.filename,
    caption: f.caption,
    pageNum: f.pageNum,
    tags: JSON.parse(f.tags) as string[],
  }));

  return (
    <CourseDetailClient
      courseId={id}
      courseName={course.name}
      slides={slides}
      materials={materials}
      figures={figures}
    />
  );
}
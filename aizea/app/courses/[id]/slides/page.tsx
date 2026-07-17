import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SlidesClient } from "./slides-client";

interface SlidesPageProps {
  params: Promise<{ id: string }>;
}

export default async function SlidesPage({ params }: SlidesPageProps) {
  const { id: courseId } = await params;

  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      name: true,
      slides: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          title: true,
          description: true,
          order: true,
          htmlDesign: true,
        },
      },
      materials: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          filename: true,
          pageCount: true,
        },
      },
    },
  });

  if (!course) {
    notFound();
  }

  const slides = course.slides.map((s) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    order: s.order,
    htmlDesign: s.htmlDesign,
    hasContent: false, // will be determined by boxes count
  }));

  // Check which slides have content (boxes) using a single groupBy query
  const slideIds = slides.map((s) => s.id);
  const boxCounts = await db.slideBox.groupBy({
    by: ["slideId"],
    where: { slideId: { in: slideIds } },
    _count: { _all: true },
  });
  const countMap = new Map(boxCounts.map((b) => [b.slideId, b._count._all]));

  const slidesWithBoxes = slides.map((s) => ({
    ...s,
    hasContent: (countMap.get(s.id) ?? 0) > 0,
  }));

  const materials = course.materials.map((m) => ({
    id: m.id,
    filename: m.filename,
    pageCount: m.pageCount,
  }));

  return (
    <SlidesClient
      courseId={courseId}
      courseName={course.name}
      slides={slidesWithBoxes}
      materialCount={materials.length}
    />
  );
}

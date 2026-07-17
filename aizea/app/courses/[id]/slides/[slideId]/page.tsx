import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SlideDetailClient } from "./slide-detail-client";

interface SlideDetailPageProps {
  params: Promise<{ id: string; slideId: string }>;
}

export default async function SlideDetailPage({ params }: SlideDetailPageProps) {
  const { id: courseId, slideId } = await params;

  const [course, slide] = await Promise.all([
    db.course.findUnique({
      where: { id: courseId },
      select: { id: true, name: true },
    }),
    db.slide.findUnique({
      where: { id: slideId },
      include: { boxes: true },
    }),
  ]);

  if (!course || !slide) {
    notFound();
  }

  const boxIds: Record<string, string | null> = {};
  const boxContents: Record<string, string> = {
    script: "",
    relevance: "",
    narrative: "",
    exercise1: "",
    exercise2: "",
  };

  for (const box of slide.boxes) {
    boxIds[box.type] = box.id;
    boxContents[box.type] = box.content;
  }

  return (
    <SlideDetailClient
      courseId={courseId}
      courseName={course.name}
      slideId={slideId}
      slideTitle={slide.title}
      slideDescription={slide.description}
      slideOrder={slide.order}
      htmlDesign={slide.htmlDesign}
      boxIds={boxIds}
      boxContents={boxContents}
    />
  );
}
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SlideDetailClient } from "./slide-detail-client";

interface SlideDetailPageProps {
  params: Promise<{ id: string; slideId: string }>;
}

export default async function SlideDetailPage({ params }: SlideDetailPageProps) {
  const { id: courseId, slideId } = await params;

  // F5.2: fetch the course's slide list alongside the current slide.
  // The detail page OWNS its navigation context — it needs to know
  // what comes before and after so it can render the "Anterior" /
  // "Siguiente" buttons and the dropdown, without the user having
  // to bounce back to /slides. Fetching both in a single round-trip
  // also keeps the page cheap: one Promise.all, two queries.
  const [course, slide, allSlides] = await Promise.all([
    db.course.findUnique({
      where: { id: courseId },
      select: { id: true, name: true },
    }),
    db.slide.findUnique({
      where: { id: slideId },
      include: { boxes: true },
    }),
    db.slide.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select: { id: true, title: true, order: true },
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
      siblingSlides={allSlides}
    />
  );
}

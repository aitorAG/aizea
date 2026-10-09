import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { SlidesClient } from "./slides-client";
import type { SlideSummary } from "@/components/slides/SlidesHierarchy";

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
          parentSlideId: true,
          numericPath: true,
          kind: true,
          status: true,
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

  // Count boxes per slide (single groupBy) so we can derive the "fully
  // generated" state below. A concept slide is only fully generated when it
  // has BOTH content boxes AND an htmlDesign; a figure slide needs only html.
  const slideIds = course.slides.map((s) => s.id);
  const boxCounts = await db.slideBox.groupBy({
    by: ["slideId"],
    where: { slideId: { in: slideIds } },
    _count: { _all: true },
  });
  const countMap = new Map(boxCounts.map((b) => [b.slideId, b._count._all]));

  // Typed as SlideSummary[] so a future field-name drift is a COMPILE error
  // (this is the anti-regression guard for the numericPath key mismatch bug).
  const slidesWithBoxes: SlideSummary[] = course.slides.map((s) => {
    const hasContent = (countMap.get(s.id) ?? 0) > 0;
    const hasHtml = !!s.htmlDesign && s.htmlDesign.trim().length > 0;
    return {
      id: s.id,
      title: s.title,
      description: s.description,
      order: s.order,
      htmlDesign: s.htmlDesign,
      parentSlideId: s.parentSlideId,
      numericPath: s.numericPath,
      kind: s.kind,
      hasContent,
      hasHtml,
      status: s.status,
    };
  });

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

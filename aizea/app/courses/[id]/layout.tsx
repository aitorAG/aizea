import { db } from "@/lib/db";
import { CheckpointBar } from "@/components/course/CheckpointBar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { GitBranch, FileText } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

interface CourseLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

/**
 * Fetches the course's resource state to drive the CheckpointBar
 * availability. Runs server-side in the layout, so the bar is rendered
 * with the right `disabled` flags on first paint (no flash).
 */
async function CourseResourceState({ courseId }: { courseId: string }) {
  // Parallelize the three DB reads. All three are cheap counts/exists checks.
  const [hasTree, hasSlides, firstSlide] = await Promise.all([
    db.topicNode.count({ where: { courseId } }),
    db.slide.count({ where: { courseId } }),
    db.slide.findFirst({
      where: { courseId },
      orderBy: { order: "asc" },
      select: { id: true },
    }),
  ]);

  // Phase 4 is "Detalle" — it needs an actual slide to navigate to.
  // If there's no slide yet, the user must go through phase 3 first
  // (which the empty state for /slides handles).
  // F4.2 — PhaseAvailability expects booleans, so we coerce the Prisma
  // count() results (numbers) with `> 0` rather than truthiness so
  // the intent is explicit and survives a future refactor that
  // changes the return type.
  const hasTreeRows = hasTree > 0;
  const hasAnySlide = hasSlides > 0;
  const hasDetalle = hasAnySlide && firstSlide !== null;
  const firstSlideId = firstSlide?.id ?? null;

  return (
    <CheckpointBar
      courseId={courseId}
      availability={{
        1: true, // Carga — page always exists
        2: hasTreeRows, // Árbol — only after pipeline created nodes
        3: hasAnySlide, // Slides — only after at least one slide
        4: hasDetalle, // Detalle — needs a slide to navigate to
        firstSlideId,
      }}
    />
  );
}

export default async function CourseLayout({
  children,
  params,
}: CourseLayoutProps) {
  const { id } = await params;

  return (
    <div className="relative min-h-screen">
      <main className="pb-24 sm:pb-28">{children}</main>
      <Suspense
        fallback={
          // Loading state: the bar still renders with the right layout
          // but every phase is "upcoming" until the data arrives. The
          // CheckpointBar without `availability` defaults to all-available.
          <CheckpointBar courseId={id} />
        }
      >
        <CourseResourceState courseId={id} />
      </Suspense>
    </div>
  );
}

import { redirect } from "next/navigation";

interface CourseDetailPageProps {
  params: Promise<{ id: string }>;
}

/**
 * UX unification — the course detail view used to live here
 * (course-detail-client.tsx) with a SECOND upload zone, slide list and
 * figure section that competed with the phase-based flow
 * (/materials → /tree → /slides). The dashboard links to /materials,
 * so this route now simply forwards to the canonical entry point.
 */
export default async function CourseDetailPage({ params }: CourseDetailPageProps) {
  const { id } = await params;
  redirect(`/courses/${id}/materials`);
}

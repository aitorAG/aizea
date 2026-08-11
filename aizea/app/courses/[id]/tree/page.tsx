// Server component for /courses/[id]/tree — the conceptual tree viewer.
//
// Loads the course name and the TopicNode[] from the database, then
// hands them to the client component which renders the ReactFlow
// surface and the action controls. If a ProcessingJob is currently
// running for this course (segmentation/extraction/integration/
// tree-building), we pass its id + phase to the client so it can
// start polling and show the PipelineProgress sidebar.

import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import type { PipelinePhase } from "@/lib/types/pipeline";
import { TreePageClient } from "./tree-client";

interface TreePageProps {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export default async function TreePage({ params }: TreePageProps) {
  const { id: courseId } = await params;

  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, name: true },
  });

  if (!course) {
    notFound();
  }

  const treeRows = await db.topicNode.findMany({
    where: { courseId },
    orderBy: [{ depth: "asc" }, { orderIndex: "asc" }, { name: "asc" }],
  });

  const initialNodes = treeRows.map((row) => ({
    id: row.id,
    courseId: row.courseId,
    parentId: row.parentId,
    name: row.name,
    summary: row.summary,
    depth: row.depth,
    orderIndex: row.orderIndex,
    isLeaf: row.isLeaf,
    version: row.version,
    sourceMaterialId: row.sourceMaterialId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));

  // Find a currently-running job for this course (if any). The status
  // check is intentionally broad — any of the four phases counts as
  // "active" so the user sees the PipelineProgress until the entire
  // chain finishes.
  const activeJob = await db.processingJob.findFirst({
    where: {
      courseId,
      status: "running",
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true, type: true },
  });

  return (
    <TreePageClient
      courseId={courseId}
      courseName={course.name}
      initialNodes={initialNodes}
      activeJobId={activeJob?.id ?? null}
      activeJobPhase={(activeJob?.type as PipelinePhase) ?? null}
    />
  );
}

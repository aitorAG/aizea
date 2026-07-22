import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getCourseStatus } from "@/lib/utils/course-status";
import { DashboardClient } from "./dashboard-client";

export const revalidate = 60;

export interface CourseListItem {
  id: string;
  name: string;
  slideCount: number;
  materialCount: number;
  topicNodeCount: number;
  /** Derived from `topicNodeCount > 0` — used to colour the tree icon. */
  hasTree: boolean;
  /** Derived from `slideCount > 0` — used to colour the slides icon. */
  hasSlides: boolean;
  updatedAt: string;
}

async function updateCourseName(id: string, name: string) {
  "use server";
  await db.course.update({ where: { id }, data: { name } });
  revalidatePath("/");
}

export default async function DashboardPage() {
  const courses = await db.course.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        // One aggregate query returns slide, material and topic-node
        // counts. Cheaper than three separate counts.
        select: { slides: true, materials: true, topicNodes: true },
      },
    },
  });

  const courseList: CourseListItem[] = courses.map((course) => {
    const status = getCourseStatus({
      topicNodeCount: course._count.topicNodes,
      slideCount: course._count.slides,
    });
    return {
      id: course.id,
      name: course.name,
      slideCount: status.slideCount,
      materialCount: course._count.materials,
      topicNodeCount: status.topicNodeCount,
      hasTree: status.hasTree,
      hasSlides: status.hasSlides,
      updatedAt: course.updatedAt.toISOString(),
    };
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="text-primary">AI</span>zea
        </h1>
        <p className="mt-1 text-muted-foreground">
          Preparación de Materiales Docentes
        </p>
      </div>

      <DashboardClient courses={courseList} updateCourseName={updateCourseName} />
    </div>
  );
}
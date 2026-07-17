import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { DashboardClient } from "./dashboard-client";

export const revalidate = 60;

export interface CourseListItem {
  id: string;
  name: string;
  slideCount: number;
  materialCount: number;
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
        select: { slides: true, materials: true },
      },
    },
  });

  const courseList: CourseListItem[] = courses.map((course) => ({
    id: course.id,
    name: course.name,
    slideCount: course._count.slides,
    materialCount: course._count.materials,
    updatedAt: course.updatedAt.toISOString(),
  }));

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
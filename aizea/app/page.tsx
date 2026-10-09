import Link from "next/link";
import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { getCourseStatus } from "@/lib/utils/course-status";
import { getSettingsAction } from "@/lib/actions/settings";
import { KeyRound } from "lucide-react";
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
  const [courses, settings] = await Promise.all([
    db.course.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          // One aggregate query returns slide, material and topic-node
          // counts. Cheaper than three separate counts.
          select: { slides: true, materials: true, topicNodes: true },
        },
      },
    }),
    getSettingsAction(),
  ]);

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

      {/* UX — first-run onboarding. Without an API key the user cannot do
          anything with AI, yet the old design let them create courses and
          upload PDFs before discovering that in Settings. Surface the
          missing key as a prominent, actionable banner on the dashboard. */}
      {!settings.apiKeyPresent && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center"
          data-testid="onboarding-api-key-banner"
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <KeyRound className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">
              Configura tu clave de IA para empezar
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              AIzea necesita una clave de OpenRouter para generar árboles y
              diapositivas. Solo toma un minuto y todo se queda en tu equipo.
            </p>
          </div>
          <Link
            href="/settings"
            data-testid="onboarding-api-key-cta"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          >
            <KeyRound className="h-4 w-4" />
            Configurar ahora
          </Link>
        </div>
      )}

      <DashboardClient courses={courseList} updateCourseName={updateCourseName} />
    </div>
  );
}
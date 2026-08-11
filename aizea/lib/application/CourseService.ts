import { db } from "@/lib/db";
import { Course } from "@prisma/client";

export class CourseService {
  async createCourse(name: string, llmContext?: string): Promise<Course> {
    return db.course.create({
      data: { name, llmContext },
    });
  }

  async getCourse(id: string) {
    const course = await db.course.findUnique({
      where: { id },
      include: {
        materials: {
          orderBy: { createdAt: "desc" },
        },
        slides: {
          orderBy: { order: "asc" },
          include: {
            boxes: true,
          },
        },
        figures: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!course) {
      throw new Error("Curso no encontrado");
    }

    return course;
  }

  async listCourses() {
    return db.course.findMany({
      include: {
        _count: {
          select: {
            slides: true,
            materials: true,
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });
  }

  async updateCourse(
    id: string,
    data: { name?: string; llmContext?: string; slideTarget?: number | null }
  ): Promise<Course> {
    return db.course.update({
      where: { id },
      data,
    });
  }

  async deleteCourse(id: string): Promise<void> {
    await db.course.delete({
      where: { id },
    });
  }
}

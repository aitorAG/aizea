import { describe, it, expect, afterEach } from "vitest";
import { CourseService } from "@/lib/application/CourseService";
import { db } from "@/lib/db";

describe("CourseService", () => {
  const service = new CourseService();
  const createdCourseIds: string[] = [];

  afterEach(async () => {
    for (const id of createdCourseIds.splice(0)) {
      await db.course.delete({ where: { id } }).catch(() => {});
    }
  });

  it("createCourse creates a course with name", async () => {
    const course = await service.createCourse("Test Course");
    createdCourseIds.push(course.id);

    expect(course.name).toBe("Test Course");
    expect(course.id).toBeTruthy();
    expect(course.llmContext).toBeNull();
  });

  it("createCourse creates a course with llmContext", async () => {
    const course = await service.createCourse("Test Course", "some context");
    createdCourseIds.push(course.id);

    expect(course.name).toBe("Test Course");
    expect(course.llmContext).toBe("some context");
  });

  it("getCourse returns course with materials, slides and figures", async () => {
    const course = await service.createCourse("Test Course");
    createdCourseIds.push(course.id);

    const result = await service.getCourse(course.id);
    expect(result.id).toBe(course.id);
    expect(result.name).toBe("Test Course");
    expect(result.materials).toEqual([]);
    expect(result.slides).toEqual([]);
    expect(result.figures).toEqual([]);
  });

  it("getCourse throws when course is not found", async () => {
    await expect(
      service.getCourse("non-existent-id")
    ).rejects.toThrow("Curso no encontrado");
  });

  it("listCourses returns courses with slide and material counts", async () => {
    const course = await service.createCourse("List Test");
    createdCourseIds.push(course.id);

    const courses = await service.listCourses();
    const found = courses.find((c) => c.id === course.id);
    expect(found).toBeDefined();
    expect(found?._count.slides).toBe(0);
    expect(found?._count.materials).toBe(0);
  });

  it("updateCourse updates name and llmContext", async () => {
    const course = await service.createCourse("Original");
    createdCourseIds.push(course.id);

    const updated = await service.updateCourse(course.id, {
      name: "Updated",
      llmContext: "ctx",
    });

    expect(updated.name).toBe("Updated");
    expect(updated.llmContext).toBe("ctx");
  });

  it("deleteCourse removes the course", async () => {
    const course = await service.createCourse("To Delete");
    createdCourseIds.push(course.id);

    await service.deleteCourse(course.id);

    const found = await db.course.findUnique({ where: { id: course.id } });
    expect(found).toBeNull();
    createdCourseIds.splice(createdCourseIds.indexOf(course.id), 1);
  });
});

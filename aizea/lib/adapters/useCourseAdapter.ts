"use client";

import { useCallback } from "react";
import { useCourseStore } from "@/lib/stores/useCourseStore";
import {
  createCourse as createCourseAction,
  getCourse as getCourseAction,
  getCourses as getCoursesAction,
  updateCourse as updateCourseAction,
  deleteCourse as deleteCourseAction,
} from "@/lib/actions/course";

export function useCourseAdapter() {
  const setCourse = useCourseStore((s) => s.setCourse);
  const setSlides = useCourseStore((s) => s.setSlides);
  const setMaterials = useCourseStore((s) => s.setMaterials);
  const setFigures = useCourseStore((s) => s.setFigures);

  const createCourse = useCallback(async (name: string, llmContext?: string) => {
    return createCourseAction(name);
  }, []);

  const getCourse = useCallback(
    async (id: string) => {
      const data = await getCourseAction(id);
      setCourse({
        id: data.course.id,
        name: data.course.name,
        slideCount: data.slides.length,
        materialCount: data.materials.length,
        updatedAt: data.course.updatedAt.toISOString(),
      });
      setSlides(
        data.slides.map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          order: s.order,
        }))
      );
      setMaterials(
        data.materials.map((m) => ({
          id: m.id,
          filename: m.filename,
          pageCount: m.pageCount,
          createdAt: m.createdAt.toISOString(),
        }))
      );
      setFigures(
        data.figures.map((f) => ({
          id: f.id,
          filename: f.filename,
          caption: f.caption,
          pageNum: f.pageNum,
          tags: f.tags ? JSON.parse(f.tags) : [],
          createdAt: f.createdAt.toISOString(),
        }))
      );
      return data;
    },
    [setCourse, setSlides, setMaterials, setFigures]
  );

  const listCourses = useCallback(async () => {
    return getCoursesAction();
  }, []);

  const updateCourse = useCallback(
    async (id: string, data: { name?: string; llmContext?: string }) => {
      const result = await updateCourseAction(id, data);
      const currentCourse = useCourseStore.getState().course;
      if (currentCourse && currentCourse.id === id) {
        useCourseStore.getState().setCourse({
          ...currentCourse,
          name: result.name,
        });
      }
      return result;
    },
    []
  );

  const deleteCourse = useCallback(
    async (id: string) => {
      await deleteCourseAction(id);
      const currentCourse = useCourseStore.getState().course;
      if (currentCourse && currentCourse.id === id) {
        useCourseStore.getState().setCourse(null);
        useCourseStore.getState().setSlides([]);
        useCourseStore.getState().setMaterials([]);
        useCourseStore.getState().setFigures([]);
      }
    },
    []
  );

  return {
    createCourse,
    getCourse,
    listCourses,
    updateCourse,
    deleteCourse,
  };
}

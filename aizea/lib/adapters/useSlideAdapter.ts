"use client";

import { useCallback } from "react";
import { useCourseStore } from "@/lib/stores/useCourseStore";
import { useGenerationStore } from "@/lib/stores/useGenerationStore";
import {
  generateOutline as generateOutlineAction,
  generateSlideContent as generateSlideContentAction,
  regenerateHtmlDesign as regenerateHtmlDesignAction,
} from "@/lib/actions/generate";
import {
  reorderSlides as reorderSlidesAction,
  createSlide as createSlideAction,
  updateSlide as updateSlideAction,
  deleteSlide as deleteSlideAction,
} from "@/lib/actions/slide";

export function useSlideAdapter(courseId: string) {
  const setSlides = useCourseStore((s) => s.setSlides);
  const addSlide = useCourseStore((s) => s.addSlide);
  const removeSlide = useCourseStore((s) => s.removeSlide);
  const updateSlideInStore = useCourseStore((s) => s.updateSlide);
  const reorderSlidesInStore = useCourseStore((s) => s.reorderSlides);

  const startGeneration = useGenerationStore((s) => s.startGeneration);
  const updateProgress = useGenerationStore((s) => s.updateProgress);
  const completeGeneration = useGenerationStore((s) => s.completeGeneration);
  const failGeneration = useGenerationStore((s) => s.failGeneration);

  const generateOutline = useCallback(
    async (selectedNodeIds: string[]) => {
      startGeneration();
      try {
        const result = await generateOutlineAction(courseId, selectedNodeIds);
        completeGeneration();
        return result;
      } catch (err) {
        failGeneration(
          err instanceof Error ? err.message : "Error al generar esquema"
        );
        throw err;
      }
    },
    [courseId, startGeneration, completeGeneration, failGeneration]
  );

  const generateSlideContent = useCallback(
    async (slideId: string) => {
      startGeneration();
      try {
        const result = await generateSlideContentAction(slideId);
        updateProgress(100, slideId);
        completeGeneration();
        return result;
      } catch (err) {
        failGeneration(
          err instanceof Error ? err.message : "Error al generar contenido"
        );
        throw err;
      }
    },
    [startGeneration, updateProgress, completeGeneration, failGeneration]
  );

  const regenerateHtmlDesign = useCallback(
    async (slideId: string, designInstructions: string) => {
      startGeneration();
      try {
        const result = await regenerateHtmlDesignAction(
          slideId,
          designInstructions
        );
        updateProgress(100, slideId);
        completeGeneration();
        return result;
      } catch (err) {
        failGeneration(
          err instanceof Error
            ? err.message
            : "Error al regenerar diseño HTML"
        );
        throw err;
      }
    },
    [startGeneration, updateProgress, completeGeneration, failGeneration]
  );

  const reorderSlides = useCallback(
    async (slideIds: string[]) => {
      await reorderSlidesAction(courseId, slideIds);
      reorderSlidesInStore(slideIds);
    },
    [courseId, reorderSlidesInStore]
  );

  const createSlide = useCallback(
    async (title: string, description: string) => {
      const result = await createSlideAction(courseId, title, description);
      addSlide({
        id: result.id,
        title: result.title,
        description: result.description,
        order: result.order,
      });
      return result;
    },
    [courseId, addSlide]
  );

  const updateSlide = useCallback(
    async (
      slideId: string,
      data: { title?: string; description?: string; htmlDesign?: string }
    ) => {
      const result = await updateSlideAction(slideId, data);
      updateSlideInStore(slideId, data);
      return result;
    },
    [updateSlideInStore]
  );

  const deleteSlide = useCallback(
    async (slideId: string) => {
      await deleteSlideAction(slideId);
      removeSlide(slideId);
    },
    [removeSlide]
  );

  return {
    generateOutline,
    generateOutlineFromTree: generateOutline,
    generateSlideContent,
    regenerateHtmlDesign,
    reorderSlides,
    createSlide,
    updateSlide,
    deleteSlide,
  };
}

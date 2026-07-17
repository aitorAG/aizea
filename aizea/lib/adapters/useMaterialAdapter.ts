"use client";

import { useCallback } from "react";
import { useCourseStore } from "@/lib/stores/useCourseStore";
import {
  uploadMaterial as uploadMaterialAction,
  deleteMaterial as deleteMaterialAction,
} from "@/lib/actions/material";

export function useMaterialAdapter(courseId: string) {
  const setMaterials = useCourseStore((s) => s.setMaterials);

  const uploadMaterial = useCallback(
    async (formData: FormData) => {
      const result = await uploadMaterialAction(courseId, formData);
      return result;
    },
    [courseId]
  );

  const deleteMaterial = useCallback(
    async (id: string) => {
      await deleteMaterialAction(id);
      const currentMaterials = useCourseStore.getState().materials;
      useCourseStore
        .getState()
        .setMaterials(currentMaterials.filter((m) => m.id !== id));
    },
    []
  );

  return {
    uploadMaterial,
    deleteMaterial,
  };
}

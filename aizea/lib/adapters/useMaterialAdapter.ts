"use client";

import { useCallback } from "react";
import { useCourseStore } from "@/lib/stores/useCourseStore";
import {
  deleteMaterial as deleteMaterialAction,
  uploadMaterial as uploadMaterialAction,
} from "@/lib/actions/material";

/**
 * v1.8.1 / Issue 2 — Reverted to the simpler server-action call.
 *
 * The previous v1.8 implementation used XMLHttpRequest so we could
 * stream real byte-level progress via `xhr.upload.onprogress`. In
 * practice that path was fragile:
 *   - The route `/api/courses/{id}/materials/upload` was a thin
 *     proxy over the same use case the server action already
 *     called, so the wire format was duplicated.
 *   - The XHR `onload` handler is not as battle-tested as `fetch`
 *     in Next.js 15 (App Router) — some `Response` shaping
 *     differences (e.g. the route returning JSON but the action
 *     returning a plain object) made the happy path subtly
 *     different between the two entry points.
 *
 * The user reported the spinner never went away and the file
 * never appeared in the list. Rather than debug the XHR plumbing
 * one more time, we collapse both paths to the single source of
 * truth: the `uploadMaterial` server action.
 *
 * The progress bar is now a fake/estimated animation. It ticks
 * toward ~90% over `estimatedDurationMs` and then jumps to 100%
 * when the action resolves (success OR failure). The visual
 * effect is the same as real byte-level progress for typical
 * small-to-medium files, without the wire-format duplication.
 */
export interface UploadMaterialResponse {
  id: string;
  content: string;
  filename: string;
}

export type ProgressCallback = (percent: number) => void;

export interface UploadMaterialOptions {
  /**
   * Receives fake progress (0..100) while the upload is in flight.
   * The adapter is guaranteed to fire `0` immediately and `100` on
   * completion; intermediate values are spaced evenly so the bar
   * appears to grow smoothly.
   */
  onProgress?: ProgressCallback;
  /**
   * Approximate time (ms) the animation should take to reach ~90%.
   * Defaults to 1500ms — short enough to feel snappy, long enough
   * for a tiny file to "show" the bar moving. The adapter ALWAYS
   * jumps to 100% when the action resolves, so this only affects
   * the visual pacing, not the actual completion semantics.
   */
  estimatedDurationMs?: number;
}

export interface UseMaterialAdapter {
  uploadMaterial: (
    formData: FormData,
    options?: UploadMaterialOptions
  ) => Promise<UploadMaterialResponse>;
  deleteMaterial: (id: string) => Promise<void>;
}

const DEFAULT_ESTIMATED_DURATION_MS = 1500;
/** Number of synthetic progress ticks. With the default 1500ms
 *  this is one tick every ~150ms — smooth to the eye, cheap to
 *  schedule. */
const PROGRESS_TICK_COUNT = 9;
/** Cap below 100% so the bar never visually "completes" before
 *  the server action actually returns. We jump to 100% on
 *  resolve. */
const FAKE_PROGRESS_CAP = 90;

export function useMaterialAdapter(courseId: string): UseMaterialAdapter {
  const setMaterials = useCourseStore((s) => s.setMaterials);

  const uploadMaterial = useCallback(
    async (
      formData: FormData,
      options?: UploadMaterialOptions
    ): Promise<UploadMaterialResponse> => {
      const onProgress = options?.onProgress;
      const estimatedDuration =
        options?.estimatedDurationMs ?? DEFAULT_ESTIMATED_DURATION_MS;
      const tickMs = Math.max(
        50,
        Math.floor(estimatedDuration / PROGRESS_TICK_COUNT)
      );
      const stepSize = Math.floor(FAKE_PROGRESS_CAP / PROGRESS_TICK_COUNT);

      // Start the visual progress at 0 so the bar is consistent
      // across rapid back-to-back uploads (otherwise the bar
      // could "snap" from 100% of the previous file to 0% of the
      // next one on the same render).
      onProgress?.(0);

      let value = 0;
      const interval = setInterval(() => {
        if (value >= FAKE_PROGRESS_CAP) return;
        value = Math.min(FAKE_PROGRESS_CAP, value + stepSize);
        onProgress?.(value);
      }, tickMs);

      try {
        const result = await uploadMaterialAction(courseId, formData);
        return result;
      } finally {
        clearInterval(interval);
        // Always reach 100% on the way out — success or error.
        // The caller is responsible for resetting the bar to 0
        // when starting the next file (the page already does
        // this in `handleFiles`).
        onProgress?.(100);
      }
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

import { create } from "zustand";

type GenerationStatus = "idle" | "generating" | "complete" | "error";

interface GenerationState {
  status: GenerationStatus;
  progress: number;
  currentSlide: string | null;
  error: string | null;
  isGenerating: boolean;
  progressPercent: number;
}

interface GenerationActions {
  startGeneration: () => void;
  updateProgress: (progress: number, currentSlide?: string | null) => void;
  completeGeneration: () => void;
  failGeneration: (error: string) => void;
}

export const useGenerationStore = create<GenerationState & GenerationActions>((set) => ({
  status: "idle",
  progress: 0,
  currentSlide: null,
  error: null,
  isGenerating: false,
  progressPercent: 0,

  startGeneration: () =>
    set({
      status: "generating",
      progress: 0,
      currentSlide: null,
      error: null,
      isGenerating: true,
      progressPercent: 0,
    }),

  updateProgress: (progress, currentSlide = null) =>
    set((state) => {
      const clamped = Math.min(100, Math.max(0, progress));
      return {
        progress: clamped,
        progressPercent: clamped,
        currentSlide: currentSlide ?? state.currentSlide,
      };
    }),

  completeGeneration: () =>
    set({
      status: "complete",
      progress: 100,
      currentSlide: null,
      error: null,
      isGenerating: false,
      progressPercent: 100,
    }),

  failGeneration: (error) =>
    set({
      status: "error",
      progress: 0,
      currentSlide: null,
      error,
      isGenerating: false,
      progressPercent: 0,
    }),
}));

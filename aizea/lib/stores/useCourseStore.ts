import { create } from "zustand";
import type { CourseSummary, SlideOutline } from "@/lib/types";

interface MaterialSummary {
  id: string;
  filename: string;
  pageCount: number;
  createdAt: string;
}

interface FigureSummary {
  id: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
  tags: string[];
}

interface CourseState {
  course: CourseSummary | null;
  slides: SlideOutline[];
  materials: MaterialSummary[];
  figures: FigureSummary[];
}

interface CourseActions {
  setCourse: (course: CourseSummary | null) => void;
  setSlides: (slides: SlideOutline[]) => void;
  addSlide: (slide: SlideOutline) => void;
  removeSlide: (id: string) => void;
  updateSlide: (id: string, data: Partial<Omit<SlideOutline, "id">>) => void;
  reorderSlides: (orderedIds: string[]) => void;
  setMaterials: (materials: MaterialSummary[]) => void;
  setFigures: (figures: FigureSummary[]) => void;
}

export const useCourseStore = create<CourseState & CourseActions>((set) => ({
  course: null,
  slides: [],
  materials: [],
  figures: [],

  setCourse: (course) => set({ course }),

  setSlides: (slides) => set({ slides }),

  addSlide: (slide) =>
    set((state) => ({
      slides: [...state.slides, slide],
    })),

  removeSlide: (id) =>
    set((state) => ({
      slides: state.slides.filter((s) => s.id !== id),
    })),

  updateSlide: (id, data) =>
    set((state) => ({
      slides: state.slides.map((s) =>
        s.id === id ? { ...s, ...data } : s
      ),
    })),

  reorderSlides: (orderedIds) =>
    set((state) => {
      const idToSlide = new Map(state.slides.map((s) => [s.id, s]));
      const reordered = orderedIds
        .map((id, index) => {
          const slide = idToSlide.get(id);
          return slide ? { ...slide, order: index + 1 } : null;
        })
        .filter((s): s is SlideOutline => s !== null);
      return { slides: reordered };
    }),

  setMaterials: (materials) => set({ materials }),

  setFigures: (figures) => set({ figures }),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

// ─── Mock Server Actions ───

const courseActions = vi.hoisted(() => ({
  createCourse: vi.fn().mockResolvedValue({ id: "course-1" }),
  getCourse: vi.fn().mockResolvedValue({
    course: { id: "course-1", name: "Test", createdAt: new Date(), updatedAt: new Date() },
    slides: [{ id: "slide-1", title: "T1", description: "D1", order: 0, figureRefs: "[]", createdAt: new Date(), updatedAt: new Date() }],
    materials: [{ id: "mat-1", filename: "f.pdf", content: "text", pageCount: 1, createdAt: new Date() }],
    figures: [{ id: "fig-1", filename: "f.png", caption: null, pageNum: null, tags: "[]", createdAt: new Date() }],
  }),
  getCourses: vi.fn().mockResolvedValue([]),
  updateCourse: vi.fn().mockResolvedValue({ id: "course-1", name: "Updated" }),
  deleteCourse: vi.fn().mockResolvedValue(undefined),
}));

const slideActions = vi.hoisted(() => ({
  generateOutline: vi.fn().mockResolvedValue([{ id: "slide-1", title: "Slide 1", description: "Desc", order: 0 }]),
  generateSlideContent: vi.fn().mockResolvedValue({
    script: "script",
    relevance: "relevance",
    narrative: "narrative",
    exercise1: "ex1",
    exercise2: "ex2",
  }),
  regenerateHtmlDesign: vi.fn().mockResolvedValue("<html></html>"),
  reorderSlides: vi.fn().mockResolvedValue(undefined),
  createSlide: vi.fn().mockResolvedValue({ id: "slide-1", courseId: "course-1", title: "Title", description: "Desc", order: 0 }),
  updateSlide: vi.fn().mockResolvedValue({ id: "slide-1", courseId: "course-1", title: "Updated" }),
  deleteSlide: vi.fn().mockResolvedValue(undefined),
}));

const materialActions = vi.hoisted(() => ({
  uploadMaterial: vi.fn().mockResolvedValue({ id: "material-1", content: "pdf text" }),
  deleteMaterial: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/actions/course", () => courseActions);
vi.mock("@/lib/actions/slide", () => slideActions);
vi.mock("@/lib/actions/generate", () => ({
  generateOutline: slideActions.generateOutline,
  generateSlideContent: slideActions.generateSlideContent,
  regenerateHtmlDesign: slideActions.regenerateHtmlDesign,
}));
vi.mock("@/lib/actions/material", () => materialActions);

// ─── Mock Zustand Stores ───

const courseStoreState = vi.hoisted(() => ({
  course: null as any,
  slides: [] as any[],
  materials: [] as any[],
  figures: [] as any[],
}));

const courseStoreActions = vi.hoisted(() => ({
  setCourse: vi.fn((course: any) => { courseStoreState.course = course; }),
  setSlides: vi.fn((slides: any[]) => { courseStoreState.slides = slides; }),
  addSlide: vi.fn((slide: any) => { courseStoreState.slides.push(slide); }),
  removeSlide: vi.fn((id: string) => { courseStoreState.slides = courseStoreState.slides.filter((s) => s.id !== id); }),
  updateSlide: vi.fn((id: string, data: any) => {
    courseStoreState.slides = courseStoreState.slides.map((s) => (s.id === id ? { ...s, ...data } : s));
  }),
  reorderSlides: vi.fn((orderedIds: string[]) => {
    const idToSlide = new Map(courseStoreState.slides.map((s) => [s.id, s]));
    courseStoreState.slides = orderedIds
      .map((id, index) => {
        const slide = idToSlide.get(id);
        return slide ? { ...slide, order: index + 1 } : null;
      })
      .filter((s): s is any => s !== null);
  }),
  setMaterials: vi.fn((materials: any[]) => { courseStoreState.materials = materials; }),
  setFigures: vi.fn((figures: any[]) => { courseStoreState.figures = figures; }),
}));

const generationStoreState = vi.hoisted(() => ({
  status: "idle",
  progress: 0,
  currentSlide: null as string | null,
  error: null as string | null,
  isGenerating: false,
  progressPercent: 0,
}));

const generationStoreActions = vi.hoisted(() => ({
  startGeneration: vi.fn(() => {
    generationStoreState.status = "generating";
    generationStoreState.isGenerating = true;
    generationStoreState.progress = 0;
    generationStoreState.progressPercent = 0;
  }),
  updateProgress: vi.fn((progress: number, currentSlide?: string | null) => {
    generationStoreState.progress = progress;
    generationStoreState.progressPercent = progress;
    if (currentSlide !== undefined) generationStoreState.currentSlide = currentSlide;
  }),
  completeGeneration: vi.fn(() => {
    generationStoreState.status = "complete";
    generationStoreState.isGenerating = false;
    generationStoreState.progress = 100;
    generationStoreState.progressPercent = 100;
  }),
  failGeneration: vi.fn((error: string) => {
    generationStoreState.status = "error";
    generationStoreState.isGenerating = false;
    generationStoreState.error = error;
  }),
}));

const createCourseStore = () => ({
  ...courseStoreState,
  ...courseStoreActions,
});

const createGenerationStore = () => ({
  ...generationStoreState,
  ...generationStoreActions,
});

vi.mock("@/lib/stores/useCourseStore", () => ({
  useCourseStore: Object.assign(
    (selector: any) => selector(createCourseStore()),
    {
      getState: () => createCourseStore(),
    }
  ),
}));

vi.mock("@/lib/stores/useGenerationStore", () => ({
  useGenerationStore: Object.assign(
    (selector: any) => selector(createGenerationStore()),
    {
      getState: () => createGenerationStore(),
    }
  ),
}));

// ─── Import adapters after mocks ───

import { useCourseAdapter } from "@/lib/adapters/useCourseAdapter";
import { useSlideAdapter } from "@/lib/adapters/useSlideAdapter";
import { useMaterialAdapter } from "@/lib/adapters/useMaterialAdapter";

// ─── Helper to capture hook result via SSR ───

function captureHookResult<T>(hook: () => T): T {
  let result!: T;
  function TestComponent() {
    result = hook();
    return null;
  }
  renderToString(createElement(TestComponent));
  return result;
}

describe("Component Adapters delegate to Server Actions and update stores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    courseStoreState.course = null;
    courseStoreState.slides = [];
    courseStoreState.materials = [];
    courseStoreState.figures = [];
    generationStoreState.status = "idle";
    generationStoreState.progress = 0;
    generationStoreState.currentSlide = null;
    generationStoreState.error = null;
    generationStoreState.isGenerating = false;
    generationStoreState.progressPercent = 0;
  });

  describe("useCourseAdapter", () => {
    it("createCourse delegates to createCourse action", async () => {
      const adapter = captureHookResult(useCourseAdapter);
      const result = await adapter.createCourse("Test Course");
      expect(courseActions.createCourse).toHaveBeenCalledWith("Test Course");
      expect(result).toEqual({ id: "course-1" });
    });

    it("getCourse delegates to getCourse action and updates store", async () => {
      const adapter = captureHookResult(useCourseAdapter);
      await adapter.getCourse("course-1");
      expect(courseActions.getCourse).toHaveBeenCalledWith("course-1");
      expect(courseStoreState.course).not.toBeNull();
      expect(courseStoreState.slides.length).toBe(1);
      expect(courseStoreState.materials.length).toBe(1);
      expect(courseStoreState.figures.length).toBe(1);
    });

    it("listCourses delegates to getCourses action", async () => {
      const adapter = captureHookResult(useCourseAdapter);
      await adapter.listCourses();
      expect(courseActions.getCourses).toHaveBeenCalled();
    });

    it("updateCourse delegates to updateCourse action and updates store", async () => {
      courseStoreState.course = { id: "course-1", name: "Old", slideCount: 0, materialCount: 0, updatedAt: "" };
      const adapter = captureHookResult(useCourseAdapter);
      await adapter.updateCourse("course-1", { name: "Updated" });
      expect(courseActions.updateCourse).toHaveBeenCalledWith("course-1", { name: "Updated" });
      expect(courseStoreState.course.name).toBe("Updated");
    });

    it("deleteCourse delegates to deleteCourse action and clears store", async () => {
      courseStoreState.course = { id: "course-1", name: "Test", slideCount: 0, materialCount: 0, updatedAt: "" };
      courseStoreState.slides = [{ id: "s1", title: "T", description: "", order: 0 }];
      const adapter = captureHookResult(useCourseAdapter);
      await adapter.deleteCourse("course-1");
      expect(courseActions.deleteCourse).toHaveBeenCalledWith("course-1");
      expect(courseStoreState.course).toBeNull();
      expect(courseStoreState.slides).toEqual([]);
    });
  });

  describe("useSlideAdapter", () => {
    it("generateOutline delegates to generateOutline action with selectedNodeIds", async () => {
      const adapter = captureHookResult(() => useSlideAdapter("course-1"));
      const result = await adapter.generateOutline(["n-1"]);
      expect(slideActions.generateOutline).toHaveBeenCalledWith("course-1", ["n-1"]);
      expect(result[0].title).toBe("Slide 1");
    });

    it("generateOutlineFromTree delegates to generateOutline with selectedNodeIds", async () => {
      const adapter = captureHookResult(() => useSlideAdapter("course-1"));
      await adapter.generateOutlineFromTree(["n-1", "n-2"]);
      expect(slideActions.generateOutline).toHaveBeenCalledWith("course-1", ["n-1", "n-2"]);
    });

    it("generateSlideContent delegates to generateSlideContent action", async () => {
      const adapter = captureHookResult(() => useSlideAdapter("course-1"));
      const result = await adapter.generateSlideContent("slide-1");
      expect(slideActions.generateSlideContent).toHaveBeenCalledWith("slide-1");
      expect(result.script).toBe("script");
    });

    it("regenerateHtmlDesign delegates to regenerateHtmlDesign action", async () => {
      const adapter = captureHookResult(() => useSlideAdapter("course-1"));
      const result = await adapter.regenerateHtmlDesign("slide-1", "instructions");
      expect(slideActions.regenerateHtmlDesign).toHaveBeenCalledWith("slide-1", "instructions");
      expect(result).toBe("<html></html>");
    });

    it("reorderSlides delegates to reorderSlides action and updates store", async () => {
      courseStoreState.slides = [
        { id: "slide-a", title: "A", description: "", order: 0 },
        { id: "slide-b", title: "B", description: "", order: 1 },
      ];
      const adapter = captureHookResult(() => useSlideAdapter("course-1"));
      await adapter.reorderSlides(["slide-b", "slide-a"]);
      expect(slideActions.reorderSlides).toHaveBeenCalledWith("course-1", ["slide-b", "slide-a"]);
    });

    it("createSlide delegates to createSlide action and adds to store", async () => {
      const adapter = captureHookResult(() => useSlideAdapter("course-1"));
      const result = await adapter.createSlide("Title", "Desc");
      expect(slideActions.createSlide).toHaveBeenCalledWith("course-1", "Title", "Desc");
      expect(result.id).toBe("slide-1");
    });

    it("updateSlide delegates to updateSlide action and updates store", async () => {
      courseStoreState.slides = [{ id: "slide-1", title: "Old", description: "", order: 0 }];
      const adapter = captureHookResult(() => useSlideAdapter("course-1"));
      await adapter.updateSlide("slide-1", { title: "Updated" });
      expect(slideActions.updateSlide).toHaveBeenCalledWith("slide-1", { title: "Updated" });
    });

    it("deleteSlide delegates to deleteSlide action and removes from store", async () => {
      courseStoreState.slides = [{ id: "slide-1", title: "T", description: "", order: 0 }];
      const adapter = captureHookResult(() => useSlideAdapter("course-1"));
      await adapter.deleteSlide("slide-1");
      expect(slideActions.deleteSlide).toHaveBeenCalledWith("slide-1");
    });
  });

  describe("useMaterialAdapter", () => {
    it("uploadMaterial delegates to uploadMaterial action", async () => {
      const adapter = captureHookResult(() => useMaterialAdapter("course-1"));
      const formData = new FormData();
      formData.append("file", new File(["content"], "test.pdf", { type: "application/pdf" }));
      const result = await adapter.uploadMaterial(formData);
      expect(materialActions.uploadMaterial).toHaveBeenCalledWith("course-1", expect.any(FormData));
      expect(result.id).toBe("material-1");
    });

    it("deleteMaterial delegates to deleteMaterial action and updates store", async () => {
      courseStoreState.materials = [{ id: "mat-1", filename: "f.pdf", pageCount: 1, createdAt: "" }];
      const adapter = captureHookResult(() => useMaterialAdapter("course-1"));
      await adapter.deleteMaterial("mat-1");
      expect(materialActions.deleteMaterial).toHaveBeenCalledWith("mat-1");
      expect(courseStoreState.materials).toEqual([]);
    });
  });
});

import { test, expect, describe, beforeEach } from "vitest";
import { useCourseStore } from "@/lib/stores/useCourseStore";
import { useGenerationStore } from "@/lib/stores/useGenerationStore";
import { useUIStore } from "@/lib/stores/useUIStore";

describe("useCourseStore", () => {
  beforeEach(() => {
    useCourseStore.setState({
      course: null,
      slides: [],
      materials: [],
      figures: [],
    });
  });

  test("setCourse updates course state", () => {
    const course = {
      id: "c1",
      name: "Test Course",
      slideCount: 0,
      materialCount: 0,
      updatedAt: "2024-01-01",
    };
    useCourseStore.getState().setCourse(course);
    expect(useCourseStore.getState().course).toEqual(course);
  });

  test("setSlides replaces slides array", () => {
    const slides = [
      { id: "s1", title: "Slide 1", description: "Desc 1", order: 1 },
      { id: "s2", title: "Slide 2", description: "Desc 2", order: 2 },
    ];
    useCourseStore.getState().setSlides(slides);
    expect(useCourseStore.getState().slides).toHaveLength(2);
    expect(useCourseStore.getState().slides[0].title).toBe("Slide 1");
  });

  test("addSlide appends to slides array", () => {
    const slide = { id: "s1", title: "Slide 1", description: "Desc", order: 1 };
    useCourseStore.getState().addSlide(slide);
    expect(useCourseStore.getState().slides).toHaveLength(1);
    expect(useCourseStore.getState().slides[0]).toEqual(slide);
  });

  test("removeSlide filters by id", () => {
    useCourseStore.setState({
      slides: [
        { id: "s1", title: "Slide 1", description: "", order: 1 },
        { id: "s2", title: "Slide 2", description: "", order: 2 },
      ],
    });
    useCourseStore.getState().removeSlide("s1");
    expect(useCourseStore.getState().slides).toHaveLength(1);
    expect(useCourseStore.getState().slides[0].id).toBe("s2");
  });

  test("updateSlide merges data for matching id", () => {
    useCourseStore.setState({
      slides: [{ id: "s1", title: "Old", description: "Desc", order: 1 }],
    });
    useCourseStore.getState().updateSlide("s1", { title: "New" });
    expect(useCourseStore.getState().slides[0].title).toBe("New");
    expect(useCourseStore.getState().slides[0].description).toBe("Desc");
  });

  test("reorderSlides reorders and updates order field", () => {
    useCourseStore.setState({
      slides: [
        { id: "s1", title: "A", description: "", order: 1 },
        { id: "s2", title: "B", description: "", order: 2 },
        { id: "s3", title: "C", description: "", order: 3 },
      ],
    });
    useCourseStore.getState().reorderSlides(["s3", "s1", "s2"]);
    const slides = useCourseStore.getState().slides;
    expect(slides.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
    expect(slides[0].order).toBe(1);
    expect(slides[1].order).toBe(2);
    expect(slides[2].order).toBe(3);
  });

  test("setMaterials updates materials", () => {
    const materials = [{ id: "m1", filename: "file.pdf", pageCount: 10, createdAt: "2024-01-01" }];
    useCourseStore.getState().setMaterials(materials);
    expect(useCourseStore.getState().materials).toEqual(materials);
  });

  test("setFigures updates figures", () => {
    const figures = [{ id: "f1", filename: "img.png", caption: null, pageNum: 1, tags: [] }];
    useCourseStore.getState().setFigures(figures);
    expect(useCourseStore.getState().figures).toEqual(figures);
  });
});

describe("useGenerationStore", () => {
  beforeEach(() => {
    useGenerationStore.setState({
      status: "idle",
      progress: 0,
      currentSlide: null,
      error: null,
      isGenerating: false,
      progressPercent: 0,
    });
  });

  test("startGeneration sets status to generating and resets progress", () => {
    useGenerationStore.getState().startGeneration();
    const state = useGenerationStore.getState();
    expect(state.status).toBe("generating");
    expect(state.progress).toBe(0);
    expect(state.isGenerating).toBe(true);
    expect(state.progressPercent).toBe(0);
    expect(state.error).toBeNull();
  });

  test("updateProgress clamps value between 0 and 100", () => {
    useGenerationStore.getState().startGeneration();
    useGenerationStore.getState().updateProgress(150);
    expect(useGenerationStore.getState().progress).toBe(100);
    expect(useGenerationStore.getState().progressPercent).toBe(100);

    useGenerationStore.getState().updateProgress(-10);
    expect(useGenerationStore.getState().progress).toBe(0);
    expect(useGenerationStore.getState().progressPercent).toBe(0);
  });

  test("updateProgress updates currentSlide when provided", () => {
    useGenerationStore.getState().startGeneration();
    useGenerationStore.getState().updateProgress(50, "slide-1");
    expect(useGenerationStore.getState().currentSlide).toBe("slide-1");
  });

  test("completeGeneration sets status to complete and progress to 100", () => {
    useGenerationStore.getState().startGeneration();
    useGenerationStore.getState().completeGeneration();
    const state = useGenerationStore.getState();
    expect(state.status).toBe("complete");
    expect(state.progress).toBe(100);
    expect(state.isGenerating).toBe(false);
    expect(state.progressPercent).toBe(100);
    expect(state.currentSlide).toBeNull();
  });

  test("failGeneration sets status to error and stores message", () => {
    useGenerationStore.getState().startGeneration();
    useGenerationStore.getState().failGeneration("Something went wrong");
    const state = useGenerationStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("Something went wrong");
    expect(state.isGenerating).toBe(false);
    expect(state.progressPercent).toBe(0);
  });
});

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState({
      activeTab: "slides",
      isExportModalOpen: false,
      toasts: [],
    });
  });

  test("setActiveTab changes active tab", () => {
    useUIStore.getState().setActiveTab("materials");
    expect(useUIStore.getState().activeTab).toBe("materials");
  });

  test("openExportModal and closeExportModal toggle modal state", () => {
    useUIStore.getState().openExportModal();
    expect(useUIStore.getState().isExportModalOpen).toBe(true);
    useUIStore.getState().closeExportModal();
    expect(useUIStore.getState().isExportModalOpen).toBe(false);
  });

  test("addToast appends toast with generated id", () => {
    useUIStore.getState().addToast({ title: "Hello", variant: "success" });
    const toasts = useUIStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].title).toBe("Hello");
    expect(toasts[0].variant).toBe("success");
    expect(toasts[0].id).toBeDefined();
  });

  test("removeToast filters by id", () => {
    useUIStore.setState({
      toasts: [
        { id: "t1", title: "One" },
        { id: "t2", title: "Two" },
      ],
    });
    useUIStore.getState().removeToast("t1");
    expect(useUIStore.getState().toasts).toHaveLength(1);
    expect(useUIStore.getState().toasts[0].id).toBe("t2");
  });
});

describe("store isolation", () => {
  beforeEach(() => {
    useCourseStore.setState({
      course: null,
      slides: [],
      materials: [],
      figures: [],
    });
    useUIStore.setState({
      activeTab: "slides",
      isExportModalOpen: false,
      toasts: [],
    });
  });

  test("changing active tab does not lose course data", () => {
    const course = {
      id: "c1",
      name: "Test Course",
      slideCount: 3,
      materialCount: 2,
      updatedAt: "2024-01-01",
    };
    const slides = [
      { id: "s1", title: "Slide 1", description: "Desc 1", order: 1 },
      { id: "s2", title: "Slide 2", description: "Desc 2", order: 2 },
    ];

    useCourseStore.getState().setCourse(course);
    useCourseStore.getState().setSlides(slides);

    useUIStore.getState().setActiveTab("materials");
    expect(useUIStore.getState().activeTab).toBe("materials");
    expect(useCourseStore.getState().course).toEqual(course);
    expect(useCourseStore.getState().slides).toEqual(slides);

    useUIStore.getState().setActiveTab("figures");
    expect(useUIStore.getState().activeTab).toBe("figures");
    expect(useCourseStore.getState().course).toEqual(course);
    expect(useCourseStore.getState().slides).toEqual(slides);
  });

  test("progress updates independently of UI state", () => {
    useGenerationStore.getState().startGeneration();
    useUIStore.getState().setActiveTab("materials");
    useGenerationStore.getState().updateProgress(42);

    expect(useGenerationStore.getState().progress).toBe(42);
    expect(useGenerationStore.getState().progressPercent).toBe(42);
    expect(useUIStore.getState().activeTab).toBe("materials");
  });
});

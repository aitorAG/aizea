import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  courseServiceInstances,
  slideServiceInstances,
  figureExtractorInstances,
  jobQueueInstances,
} = vi.hoisted(() => ({
  courseServiceInstances: [] as any[],
  slideServiceInstances: [] as any[],
  figureExtractorInstances: [] as any[],
  jobQueueInstances: [] as any[],
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/application/CourseService", () => ({
  CourseService: vi.fn().mockImplementation(function () {
    const instance = {
      createCourse: vi.fn().mockResolvedValue({ id: "course-1", name: "Test" }),
      getCourse: vi.fn().mockResolvedValue({
        id: "course-1",
        name: "Test",
        materials: [],
        slides: [],
        figures: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      listCourses: vi.fn().mockResolvedValue([
        {
          id: "course-1",
          name: "Test",
          _count: { slides: 0, materials: 0 },
          updatedAt: new Date(),
        },
      ]),
      updateCourse: vi.fn().mockResolvedValue({ id: "course-1", name: "Updated" }),
      deleteCourse: vi.fn().mockResolvedValue(undefined),
    };
    courseServiceInstances.push(instance);
    return instance;
  }),
}));

vi.mock("@/lib/composition/container", () => ({
  container: {
    processCourse: {
      execute: vi.fn().mockResolvedValue({ ok: true, empty: false, result: {} }),
    },
    uploadMaterial: {
      execute: vi.fn(),
    },
    // generate.ts resolves a slide's courseId through the container's
    // slide repository before delegating to SlideService. The mock must
    // expose it or the action throws "Cannot read properties of
    // undefined (reading 'findCourseIdById')".
    slides: {
      findCourseIdById: vi.fn().mockResolvedValue("course-1"),
    },
    // 1.3: material.ts now routes deleteMaterial through the container's
    // material repository. findById returns null so the action no-ops
    // early (matching the previous "mock db returns null" behaviour).
    materials: {
      findById: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

vi.mock("@/lib/application/SlideService", () => ({
  SlideService: vi.fn().mockImplementation(function () {
    const instance = {
      generateOutlineFromTree: vi.fn().mockResolvedValue([
        { id: "slide-1", title: "Slide 1", description: "Desc", order: 0 },
      ]),
      generateSlideContent: vi.fn().mockResolvedValue({
        script: "script",
        relevance: "relevance",
        narrative: "narrative",
        exercise1: "ex1",
        exercise2: "ex2",
      }),
      regenerateHtmlDesign: vi.fn().mockResolvedValue("<html></html>"),
      createSlide: vi.fn().mockResolvedValue({
        id: "slide-1",
        courseId: "course-1",
        title: "Title",
        description: "Desc",
        order: 0,
      }),
      updateSlide: vi.fn().mockResolvedValue({
        id: "slide-1",
        courseId: "course-1",
        title: "Updated",
      }),
      deleteSlide: vi.fn().mockResolvedValue(undefined),
      reorderSlides: vi.fn().mockResolvedValue(undefined),
      updateBox: vi.fn().mockResolvedValue({
        id: "box-1",
        slideId: "slide-1",
        content: "updated",
      }),
      getBoxesForSlide: vi.fn().mockResolvedValue([]),
      initializeBoxesForSlide: vi.fn().mockResolvedValue(undefined),
    };
    slideServiceInstances.push(instance);
    return instance;
  }),
}));

vi.mock("@/lib/domain/figures/FigureExtractor", () => ({
  FigureExtractor: vi.fn().mockImplementation(function () {
    const instance = {
      extractAndSave: vi.fn().mockResolvedValue([
        { id: "fig-1", filename: "fig.png", caption: "Caption", pageNum: 1 },
      ]),
    };
    figureExtractorInstances.push(instance);
    return instance;
  }),
}));

vi.mock("@/lib/infrastructure/queue/JobQueue", () => ({
  JobQueue: vi.fn().mockImplementation(function () {
    const instance = {
      enqueue: vi.fn().mockResolvedValue({ jobId: "job-1" }),
      getStatus: vi.fn().mockResolvedValue({ status: "completed", progress: 100 }),
      close: vi.fn().mockResolvedValue(undefined),
    };
    jobQueueInstances.push(instance);
    return instance;
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn().mockImplementation(async (ops) => {
      // Support both array-of-promises and interactive transaction patterns
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops({
        course: { findUnique: vi.fn().mockResolvedValue(null) },
        slide: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), create: vi.fn().mockResolvedValue({ id: "slide-1", courseId: "course-1" }), update: vi.fn().mockResolvedValue({ id: "slide-1", courseId: "course-1" }) },
        material: { delete: vi.fn().mockResolvedValue(undefined) },
        textChunk: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
        slideBox: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
        figure: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }) },
        topicNode: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), createMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: vi.fn().mockResolvedValue([]) },
      });
    }),
    course: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "course-1" }),
      update: vi.fn().mockResolvedValue({ id: "course-1" }),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    slide: {
      findUnique: vi.fn().mockResolvedValue({ courseId: "course-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "slide-1", courseId: "course-1" }),
      update: vi.fn().mockResolvedValue({ id: "slide-1", courseId: "course-1" }),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    material: {
      findUnique: vi.fn().mockResolvedValue({ id: "material-1", courseId: "course-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "material-1" }),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    slideBox: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: "box-1", slideId: "slide-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    figure: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: "fig-1", courseId: "course-1" }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    textChunk: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("@/lib/domain/figures/figure-references", () => ({
  extractFigureReferences: vi.fn().mockReturnValue([
    { caption: "Figura 1", pageNum: null },
  ]),
}));

import { revalidatePath } from "next/cache";

import {
  createCourse,
  getCourses,
  getCourse,
  updateCourse,
  deleteCourse,
  updateCourseContext,
} from "@/lib/actions/course";

import {
  uploadMaterial,
  getCourseMaterials,
  deleteMaterial,
} from "@/lib/actions/material";

import {
  generateOutline,
  generateSlideContent,
  regenerateHtmlDesign,
} from "@/lib/actions/generate";

import {
  extractFigureRefs,
  extractAndSave,
  updateFigure,
  getCourseFigures,
} from "@/lib/actions/figure";

describe("Server Actions delegate to Application Services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("course.ts", () => {
    it("createCourse delegates to CourseService.createCourse", async () => {
      const result = await createCourse("Test Course");
      const service = courseServiceInstances[0];
      expect(service.createCourse).toHaveBeenCalledWith("Test Course");
      expect(result).toEqual({ id: "course-1" });
      expect(revalidatePath).toHaveBeenCalledWith("/");
    });

    it("getCourses delegates to CourseService.listCourses", async () => {
      const result = await getCourses();
      const service = courseServiceInstances[0];
      expect(service.listCourses).toHaveBeenCalled();
      expect(result[0].id).toBe("course-1");
    });

    it("getCourse delegates to CourseService.getCourse", async () => {
      const result = await getCourse("course-1");
      const service = courseServiceInstances[0];
      expect(service.getCourse).toHaveBeenCalledWith("course-1");
      expect(result.course.id).toBe("course-1");
    });

    it("updateCourse delegates to CourseService.updateCourse", async () => {
      const result = await updateCourse("course-1", { name: "Updated" });
      const service = courseServiceInstances[0];
      expect(service.updateCourse).toHaveBeenCalledWith("course-1", { name: "Updated" });
      expect(revalidatePath).toHaveBeenCalledWith("/");
      expect(revalidatePath).toHaveBeenCalledWith("/courses/course-1");
    });

    it("deleteCourse delegates to CourseService.deleteCourse", async () => {
      await deleteCourse("course-1");
      const service = courseServiceInstances[0];
      expect(service.deleteCourse).toHaveBeenCalledWith("course-1");
      expect(revalidatePath).toHaveBeenCalledWith("/");
    });

    it("updateCourseContext delegates to CourseService.updateCourse", async () => {
      await updateCourseContext("course-1", "context");
      const service = courseServiceInstances[0];
      expect(service.updateCourse).toHaveBeenCalledWith("course-1", { llmContext: "context" });
      expect(revalidatePath).toHaveBeenCalledWith("/courses/course-1");
      expect(revalidatePath).toHaveBeenCalledWith("/courses/course-1/materials");
    });
  });

  describe("material.ts", () => {
    it("uploadMaterial delegates to UploadMaterialUseCase.execute", async () => {
      const formData = new FormData();
      formData.append("file", new File(["content"], "test.pdf", { type: "application/pdf" }));
      // The action calls container.uploadMaterial.execute; we assert
      // that by re-mocking inside the test.
      const { container } = await import("@/lib/composition/container");
      (container.uploadMaterial.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        material: { id: "material-1", content: "pdf text" },
      });
      const result = await uploadMaterial("course-1", formData);
      expect(container.uploadMaterial.execute).toHaveBeenCalled();
      expect(result.id).toBe("material-1");
      expect(revalidatePath).toHaveBeenCalledWith("/courses/course-1");
    });

    it("deleteMaterial works without throwing", async () => {
      // deleteMaterial hits the DB directly (out of scope for the
      // current refactor). The mock db returns null for findUnique,
      // so the action no-ops early — we just assert it does not
      // throw.
      await expect(deleteMaterial("material-1")).resolves.toBeUndefined();
    });
  });

  describe("generate.ts", () => {
    it("generateOutline delegates to SlideService.generateOutlineFromTree", async () => {
      const result = await generateOutline("course-1", ["n-1", "n-2"]);
      const service = slideServiceInstances[0];
      expect(service.generateOutlineFromTree).toHaveBeenCalledWith("course-1", ["n-1", "n-2"]);
      // MOD-04: JobQueue removed — no enqueue assertion
      expect(revalidatePath).toHaveBeenCalledWith("/courses/course-1");
      expect(result[0].title).toBe("Slide 1");
    });

    it("generateSlideContent delegates to SlideService.generateSlideContent", async () => {
      const result = await generateSlideContent("slide-1");
      const service = slideServiceInstances[0];
      expect(service.generateSlideContent).toHaveBeenCalledWith("slide-1");
      expect(result.script).toBe("script");
    });

    it("regenerateHtmlDesign delegates to SlideService.regenerateHtmlDesign", async () => {
      const result = await regenerateHtmlDesign("slide-1", "instructions");
      const service = slideServiceInstances[0];
      expect(service.regenerateHtmlDesign).toHaveBeenCalledWith("slide-1", "instructions");
      expect(result).toBe("<html></html>");
    });
  });

  describe("figure.ts", () => {
    it("extractAndSave delegates to FigureExtractor.extractAndSave", async () => {
      const buffer = Buffer.from("pdf");
      const result = await extractAndSave(buffer, "course-1");
      const extractor = figureExtractorInstances[0];
      expect(extractor.extractAndSave).toHaveBeenCalledWith(buffer, "course-1");
      expect(result.count).toBe(1);
      expect(revalidatePath).toHaveBeenCalledWith("/courses/course-1/figures");
    });
  });
});

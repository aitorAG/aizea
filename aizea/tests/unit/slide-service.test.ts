import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "path";
import { SlideService, type LLMClientInterface } from "@/lib/application/SlideService";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { RAGEngine } from "@/lib/domain/rag/RAGEngine";
import { BoxType, type GeneratedBoxes } from "@/lib/types";

const TEST_DB_PATH = path.resolve(process.cwd(), "prisma/test-slide-service.db");
const TEST_DB_URL = "file:" + TEST_DB_PATH;

let testDb: PrismaClient;

beforeAll(() => {
  const devDb = path.resolve(process.cwd(), "prisma/dev.db");
  fs.copyFileSync(devDb, TEST_DB_PATH);

  testDb = new PrismaClient({
    datasources: {
      db: {
        url: TEST_DB_URL,
      },
    },
  });
});

beforeEach(async () => {
  await testDb.slideBox.deleteMany();
  await testDb.slide.deleteMany();
  await testDb.textChunk.deleteMany();
  await testDb.material.deleteMany();
  await testDb.topicNode.deleteMany();
  await testDb.course.deleteMany();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function createService(deps: {
  llmClient?: LLMClientInterface;
  ragEngine?: RAGEngine;
}) {
  return new SlideService(
    deps.llmClient ?? { chatJSON: vi.fn() },
    new PromptManager(),
    deps.ragEngine ?? ({} as unknown as RAGEngine),
    testDb
  );
}

describe("SlideService", () => {
  describe("generateOutlineFromTree", () => {
    async function setupCourseWithTree(nodeCount: number) {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const nodes = [];
      for (let i = 0; i < nodeCount; i++) {
        const node = await testDb.topicNode.create({
          data: {
            courseId: course.id,
            name: `Node ${i + 1}`,
            summary: `Summary of node ${i + 1}`,
            depth: 0,
            isLeaf: true,
            version: 1,
          },
        });
        nodes.push(node);
      }
      return { course, nodes };
    }

    it("creates one slide per selected node with title=node.name and description=node.summary", async () => {
      const { course, nodes } = await setupCourseWithTree(3);

      // LLM returns the nodes in the same selection order.
      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({ order: [nodes[0].id, nodes[1].id, nodes[2].id] }),
      };

      const service = createService({ llmClient: mockLlm });
      const result = await service.generateOutlineFromTree(course.id, [
        nodes[0].id,
        nodes[1].id,
        nodes[2].id,
      ]);

      expect(result).toHaveLength(3);
      expect(result[0].title).toBe("Node 1");
      expect(result[0].description).toBe("Summary of node 1");
      expect(result[2].title).toBe("Node 3");

      const slides = await testDb.slide.findMany({
        where: { courseId: course.id },
        orderBy: { order: "asc" },
      });
      expect(slides).toHaveLength(3);
      expect(slides[0].title).toBe("Node 1");
      expect(slides[1].order).toBe(1);
    });

    it("honours the LLM-returned pedagogical order", async () => {
      const { course, nodes } = await setupCourseWithTree(3);

      // LLM reverses the selection order.
      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({ order: [nodes[2].id, nodes[1].id, nodes[0].id] }),
      };

      const service = createService({ llmClient: mockLlm });
      const result = await service.generateOutlineFromTree(course.id, [
        nodes[0].id,
        nodes[1].id,
        nodes[2].id,
      ]);

      expect(result.map((s) => s.title)).toEqual([
        "Node 3",
        "Node 2",
        "Node 1",
      ]);
    });

    it("falls back to selection order when the LLM returns no order array", async () => {
      const { course, nodes } = await setupCourseWithTree(2);

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({ order: null }),
      };

      const service = createService({ llmClient: mockLlm });
      const result = await service.generateOutlineFromTree(course.id, [
        nodes[0].id,
        nodes[1].id,
      ]);

      expect(result.map((s) => s.title)).toEqual(["Node 1", "Node 2"]);
    });

    it("normalises the LLM output: drops hallucinated ids, appends missing ones", async () => {
      const { course, nodes } = await setupCourseWithTree(3);

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({
          order: [nodes[1].id, "hallucinated-id", nodes[0].id /* missing nodes[2] */],
        }),
      };

      const service = createService({ llmClient: mockLlm });
      const result = await service.generateOutlineFromTree(course.id, [
        nodes[0].id,
        nodes[1].id,
        nodes[2].id,
      ]);

      // nodes[1] then nodes[0] (in LLM order, no hallucinated id), then
      // nodes[2] appended in the original selection order.
      expect(result.map((s) => s.title)).toEqual(["Node 2", "Node 1", "Node 3"]);
    });

    it("replaces existing slides on regeneration", async () => {
      const { course, nodes } = await setupCourseWithTree(2);
      await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Old Slide",
          description: "Old",
          order: 0,
        },
      });

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({ order: [nodes[0].id, nodes[1].id] }),
      };
      const service = createService({ llmClient: mockLlm });
      await service.generateOutlineFromTree(course.id, [nodes[0].id, nodes[1].id]);

      const slides = await testDb.slide.findMany({
        where: { courseId: course.id },
      });
      expect(slides).toHaveLength(2);
      expect(slides.find((s) => s.title === "Old Slide")).toBeUndefined();
    });

    it("throws when selectedNodeIds is empty", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const service = createService({});
      await expect(
        service.generateOutlineFromTree(course.id, [])
      ).rejects.toThrow(/al menos un nodo/i);
    });

    it("throws when no selected node exists for the course", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const otherCourse = await testDb.course.create({
        data: { name: "Other Course" },
      });
      const node = await testDb.topicNode.create({
        data: {
          courseId: otherCourse.id,
          name: "Foreign",
          depth: 0,
          isLeaf: true,
          version: 1,
        },
      });

      const service = createService({});
      await expect(
        service.generateOutlineFromTree(course.id, [node.id])
      ).rejects.toThrow(/no existen en este curso/);
    });

    it("uses empty string when the node has no summary", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const node = await testDb.topicNode.create({
        data: {
          courseId: course.id,
          name: "Nameless summary",
          summary: null,
          depth: 0,
          isLeaf: true,
          version: 1,
        },
      });

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({ order: [node.id] }),
      };
      const service = createService({ llmClient: mockLlm });
      const result = await service.generateOutlineFromTree(course.id, [node.id]);
      expect(result[0].description).toBe("");
    });
  });

  describe("generateSlideContent", () => {
    it("generates boxes enriched with RAG chunks and persists them", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const material = await testDb.material.create({
        data: {
          courseId: course.id,
          filename: "test.pdf",
          content: "Material about React hooks.",
        },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "React Hooks",
          description: "Introduction to hooks",
          order: 0,
        },
      });

      const mockRag = {
        searchRelevant: vi.fn().mockResolvedValue([
          { id: "chunk-1", content: "RAG chunk about useState", chunkIndex: 0, score: 0.95 },
        ]),
      } as unknown as RAGEngine;

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({
          script: "Script content",
          relevance: "Relevance content",
          narrative: "Narrative content",
          exercise1: "Exercise 1",
          exercise2: "Exercise 2",
        } as GeneratedBoxes),
      };

      const service = createService({ llmClient: mockLlm, ragEngine: mockRag });
      const result = await service.generateSlideContent(slide.id);

      expect(result.script).toBe("Script content");
      expect(mockRag.searchRelevant).toHaveBeenCalledWith(
        "React Hooks",
        material.id,
        3
      );

      const boxes = await testDb.slideBox.findMany({
        where: { slideId: slide.id },
      });
      expect(boxes).toHaveLength(5);
      const scriptBox = boxes.find((b) => b.type === BoxType.SCRIPT);
      expect(scriptBox?.content).toBe("Script content");
    });

    it("falls back to full material text when RAG returns no chunks", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      await testDb.material.create({
        data: {
          courseId: course.id,
          filename: "test.pdf",
          content: "Full material text.",
        },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Topic",
          description: "Desc",
          order: 0,
        },
      });

      const mockRag = {
        searchRelevant: vi.fn().mockResolvedValue([]),
      } as unknown as RAGEngine;

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({
          script: "S",
          relevance: "R",
          narrative: "N",
          exercise1: "E1",
          exercise2: "E2",
        } as GeneratedBoxes),
      };

      const service = createService({ llmClient: mockLlm, ragEngine: mockRag });
      await service.generateSlideContent(slide.id);

      expect(mockLlm.chatJSON).toHaveBeenCalledOnce();
      const callArgs = (mockLlm.chatJSON as unknown as { mock: { calls: Array<[Array<{ content: string }>]> } }).mock.calls[0][0];
      const userContent = callArgs[1].content;
      expect(userContent).toContain("Full material text.");
    });

    it("throws when slide is not found", async () => {
      const service = createService({});
      await expect(
        service.generateSlideContent("non-existent-id")
      ).rejects.toThrow("Diapositiva no encontrada");
    });

    it("fills missing box fields with defaults", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      await testDb.material.create({
        data: {
          courseId: course.id,
          filename: "test.pdf",
          content: "Content",
        },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Topic",
          description: "Desc",
          order: 0,
        },
      });

      const mockRag = {
        searchRelevant: vi.fn().mockResolvedValue([]),
      } as unknown as RAGEngine;

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({
          script: "Only script",
        } as GeneratedBoxes),
      };

      const service = createService({ llmClient: mockLlm, ragEngine: mockRag });
      const result = await service.generateSlideContent(slide.id);

      expect(result.relevance).toBe("Relevancia no generada.");
      expect(result.exercise2).toBe("Ejercicio no generado.");
    });
  });

  describe("regenerateHtmlDesign", () => {
    it("updates slide htmlDesign from LLM response", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Design Slide",
          description: "Desc",
          order: 0,
        },
      });
      await testDb.slideBox.createMany({
        data: [
          { slideId: slide.id, type: BoxType.SCRIPT, content: "Script" },
          { slideId: slide.id, type: BoxType.RELEVANCE, content: "Relevance" },
          { slideId: slide.id, type: BoxType.NARRATIVE, content: "Narrative" },
        ],
      });

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({ html: "<div>New Design</div>" }),
      };

      const service = createService({ llmClient: mockLlm });
      const result = await service.regenerateHtmlDesign(
        slide.id,
        "Make it blue"
      );

      expect(result).toBe("<div>New Design</div>");

      const updated = await testDb.slide.findUnique({
        where: { id: slide.id },
      });
      expect(updated?.htmlDesign).toBe("<div>New Design</div>");
    });

    it("throws when LLM returns no html", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Design Slide",
          description: "Desc",
          order: 0,
        },
      });

      const mockLlm: LLMClientInterface = {
        chatJSON: vi.fn().mockResolvedValue({ html: "" }),
      };

      const service = createService({ llmClient: mockLlm });
      await expect(
        service.regenerateHtmlDesign(slide.id, "instructions")
      ).rejects.toThrow("La IA no generó un diseño HTML válido.");
    });

    it("throws when slide is not found", async () => {
      const service = createService({});
      await expect(
        service.regenerateHtmlDesign("non-existent", "instructions")
      ).rejects.toThrow("Diapositiva no encontrada");
    });
  });

  describe("reorderSlides", () => {
    it("updates slide orders according to provided ids", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const slide1 = await testDb.slide.create({
        data: { courseId: course.id, title: "S1", description: "D1", order: 0 },
      });
      const slide2 = await testDb.slide.create({
        data: { courseId: course.id, title: "S2", description: "D2", order: 1 },
      });
      const slide3 = await testDb.slide.create({
        data: { courseId: course.id, title: "S3", description: "D3", order: 2 },
      });

      const service = createService({});
      await service.reorderSlides(course.id, [
        slide3.id,
        slide1.id,
        slide2.id,
      ]);

      const slides = await testDb.slide.findMany({
        where: { courseId: course.id },
        orderBy: { order: "asc" },
      });
      expect(slides[0].id).toBe(slide3.id);
      expect(slides[0].order).toBe(0);
      expect(slides[1].id).toBe(slide1.id);
      expect(slides[1].order).toBe(1);
      expect(slides[2].id).toBe(slide2.id);
      expect(slides[2].order).toBe(2);
    });
  });

  describe("createSlide", () => {
    it("creates a slide with order 0 for empty course", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const service = createService({});

      const slide = await service.createSlide(
        course.id,
        "New Slide",
        "Description"
      );

      expect(slide.title).toBe("New Slide");
      expect(slide.order).toBe(0);
    });

    it("appends slide with next order for non-empty course", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Existing",
          description: "D",
          order: 2,
        },
      });

      const service = createService({});
      const slide = await service.createSlide(course.id, "New", "Desc");

      expect(slide.order).toBe(3);
    });
  });

  describe("updateSlide", () => {
    it("updates slide fields", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Old Title",
          description: "Old Desc",
          order: 0,
        },
      });

      const service = createService({});
      const updated = await service.updateSlide(slide.id, {
        title: "New Title",
        htmlDesign: "<div></div>",
      });

      expect(updated.title).toBe("New Title");
      expect(updated.htmlDesign).toBe("<div></div>");
    });
  });

  describe("deleteSlide", () => {
    it("deletes an existing slide", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "To Delete",
          description: "D",
          order: 0,
        },
      });

      const service = createService({});
      await service.deleteSlide(slide.id);

      const found = await testDb.slide.findUnique({
        where: { id: slide.id },
      });
      expect(found).toBeNull();
    });

    it("throws when slide is not found", async () => {
      const service = createService({});
      await expect(service.deleteSlide("non-existent")).rejects.toThrow(
        "Diapositiva no encontrada"
      );
    });
  });
});

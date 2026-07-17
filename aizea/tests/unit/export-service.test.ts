import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "path";
import { ExportService, NotImplementedError } from "@/lib/application/ExportService";
import { BoxType } from "@/lib/types";

const TEST_DB_PATH = path.resolve(process.cwd(), "prisma/test-export-service.db");
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
  await testDb.course.deleteMany();
});

afterAll(async () => {
  await testDb.$disconnect();
});

function createService() {
  return new ExportService(testDb);
}

describe("ExportService", () => {
  describe("exportToHtml", () => {
    it("generates self-contained HTML with slide titles and KaTeX CDN", async () => {
      const course = await testDb.course.create({
        data: { name: "Test Course" },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Intro Slide",
          description: "Introduction",
          order: 0,
          htmlDesign: "<div>Custom HTML</div>",
        },
      });
      await testDb.slideBox.createMany({
        data: [
          { slideId: slide.id, type: BoxType.SCRIPT, content: "Script text" },
          { slideId: slide.id, type: BoxType.RELEVANCE, content: "Relevance text" },
          { slideId: slide.id, type: BoxType.NARRATIVE, content: "Narrative text" },
        ],
      });

      const service = createService();
      const html = await service.exportToHtml(course.id);

      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("AIzea — Test Course");
      expect(html).toContain("katex@0.16.11/dist/katex.min.css");
      expect(html).toContain("katex@0.16.11/dist/katex.min.js");
      expect(html).toContain("Intro Slide");
      expect(html).toContain("Script text");
      expect(html).toContain("Relevance text");
      expect(html).toContain("Narrative text");
      expect(html).toContain("@page { size: A4; margin: 0; }");
      expect(html).toContain("page-break-after: always");
    });

    it("escapes HTML in slide titles and box contents", async () => {
      const course = await testDb.course.create({
        data: { name: "<script>alert(1)</script>" },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "<b>Bold</b>",
          description: "Desc",
          order: 0,
        },
      });
      await testDb.slideBox.create({
        data: {
          slideId: slide.id,
          type: BoxType.SCRIPT,
          content: "<script>evil</script>",
        },
      });

      const service = createService();
      const html = await service.exportToHtml(course.id);

      expect(html).not.toContain("<script>alert(1)</script>");
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<b>Bold</b>");
      expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt;");
      expect(html).not.toContain("<script>evil</script>");
      expect(html).toContain("&lt;script&gt;evil&lt;/script&gt;");
    });

    it("throws when course is not found", async () => {
      const service = createService();
      await expect(service.exportToHtml("non-existent-id")).rejects.toThrow(
        "Curso no encontrado"
      );
    });
  });

  describe("exportToMarkdown", () => {
    it("generates markdown with course title, slide headings, and box contents", async () => {
      const course = await testDb.course.create({
        data: { name: "Markdown Course" },
      });
      const slide1 = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "First Slide",
          description: "Desc 1",
          order: 0,
        },
      });
      const slide2 = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Second Slide",
          description: "Desc 2",
          order: 1,
        },
      });
      await testDb.slideBox.createMany({
        data: [
          { slideId: slide1.id, type: BoxType.SCRIPT, content: "Script 1" },
          { slideId: slide1.id, type: BoxType.RELEVANCE, content: "Relevance 1" },
          { slideId: slide1.id, type: BoxType.NARRATIVE, content: "Narrative 1" },
          { slideId: slide2.id, type: BoxType.SCRIPT, content: "Script 2" },
        ],
      });

      const service = createService();
      const md = await service.exportToMarkdown(course.id);

      expect(md).toContain("# Markdown Course");
      expect(md).toContain("## 1. First Slide");
      expect(md).toContain("## 2. Second Slide");
      expect(md).toContain("**Guion**");
      expect(md).toContain("Script 1");
      expect(md).toContain("Relevance 1");
      expect(md).toContain("Narrative 1");
      expect(md).toContain("Script 2");
    });

    it("omits empty box sections", async () => {
      const course = await testDb.course.create({
        data: { name: "Sparse Course" },
      });
      const slide = await testDb.slide.create({
        data: {
          courseId: course.id,
          title: "Only Script",
          description: "Desc",
          order: 0,
        },
      });
      await testDb.slideBox.create({
        data: {
          slideId: slide.id,
          type: BoxType.SCRIPT,
          content: "Only script content",
        },
      });

      const service = createService();
      const md = await service.exportToMarkdown(course.id);

      expect(md).toContain("## 1. Only Script");
      expect(md).toContain("Only script content");
      expect(md).not.toContain("**Relevancia**");
      expect(md).not.toContain("**Narrativa**");
    });

    it("throws when course is not found", async () => {
      const service = createService();
      await expect(service.exportToMarkdown("non-existent-id")).rejects.toThrow(
        "Curso no encontrado"
      );
    });
  });

  describe("exportToPptx", () => {
    it("throws NotImplementedError", async () => {
      const service = createService();
      await expect(service.exportToPptx("any-id")).rejects.toThrow(
        NotImplementedError
      );
    });
  });
});

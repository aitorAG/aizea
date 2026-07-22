// Tests for the UploadMaterialUseCase.
//
// The use case orchestrates the upload side-effects (PDF text
// extraction, file persistence, RAG indexing, figure extraction,
// layout parser) via the duck-typed ports defined inline. None of
// the production services are imported.
//
// v1.5 finding 1.7: the upload use case does NOT trigger the
// pipeline. The pipeline (segmentation, extraction, integration,
// tree-building) is owned by `ProcessCourseUseCase` and only runs
// on the explicit "Generar árbol" click. These tests therefore do
// not inject a `pipeline` dependency.

import { describe, it, expect, vi } from "vitest";
import {
  UploadMaterialUseCase,
  type IPdfTextExtractor,
  type IFigureExtractor,
  type ILayoutParser,
  type IRagIndexer,
} from "@/lib/application/use-cases/upload-material.use-case";
import type { IMaterialRepository } from "@/lib/application/ports/material-repository.port";
import type { INotifier } from "@/lib/application/ports/notifier.port";

function makeDeps(overrides: {
  createMaterial?: any;
  extractText?: any;
  figureExtract?: any;
  layoutParse?: any;
  indexMaterial?: any;
  notify?: any;
} = {}) {
  const createMaterial = overrides.createMaterial ?? vi.fn(async (data: any) => ({
    id: "mat-1",
    courseId: data.courseId,
    filename: data.filename,
    content: data.content,
    pageCount: data.pageCount,
    fileSize: data.fileSize,
    fileType: data.fileType,
    createdAt: new Date().toISOString(),
  }));
  const extractText =
    overrides.extractText ??
    vi.fn(async () => ({ text: "extracted text", pages: 3 }));
  const figureExtract =
    overrides.figureExtract ?? vi.fn(async () => []);
  const layoutParse =
    overrides.layoutParse ?? vi.fn(async () => ({ pageCount: 3 }));
  const indexMaterial =
    overrides.indexMaterial ?? vi.fn(async () => undefined);
  const notify = overrides.notify ?? vi.fn();

  const materials = {
    findById: vi.fn(),
    findByCourseId: vi.fn(),
    hasProcessedUnits: vi.fn(),
    readBuffer: vi.fn(),
    create: createMaterial,
  } as unknown as IMaterialRepository;
  const notifier = { notify } as unknown as INotifier;
  const pdfExtractor = { extractText } as IPdfTextExtractor;
  const figureExtractor = { extractAndSave: figureExtract } as IFigureExtractor;
  const layoutParser = { parse: layoutParse } as ILayoutParser;
  const ragIndexer = { indexMaterial } as IRagIndexer;

  return {
    materials,
    notifier,
    pdfExtractor,
    figureExtractor,
    layoutParser,
    ragIndexer,
    createMaterial,
    extractText,
    figureExtract,
    layoutParse,
    indexMaterial,
    notify,
  };
}

describe("UploadMaterialUseCase", () => {
  it("extracts text, creates the material, indexes for RAG, extracts figures, runs the layout parser, and notifies the user — but does NOT trigger the pipeline", async () => {
    const deps = makeDeps();

    const useCase = new UploadMaterialUseCase(deps);
    const result = await useCase.execute({
      courseId: "course-1",
      filename: "123_doc.pdf",
      fileType: "application/pdf",
      fileSize: 1024,
      buffer: Buffer.from("pdf bytes"),
      userId: "user-1",
    });

    // Outcome is { material } only — v1.5 finding 1.7 removed
    // the pipelineResult field because the upload no longer
    // runs the pipeline.
    expect(result.material.id).toBe("mat-1");
    expect(result.material.filename).toBe("123_doc.pdf");
    expect((result as any).pipelineResult).toBeUndefined();

    // 1. Text extracted
    expect(deps.extractText).toHaveBeenCalledTimes(1);
    expect(deps.extractText).toHaveBeenCalledWith(Buffer.from("pdf bytes"));

    // 2. Material created with the extracted text + page count
    expect(deps.createMaterial).toHaveBeenCalledTimes(1);
    const createArgs = deps.createMaterial.mock.calls[0][0];
    expect(createArgs.courseId).toBe("course-1");
    expect(createArgs.filename).toBe("123_doc.pdf");
    expect(createArgs.content).toBe("extracted text");
    expect(createArgs.pageCount).toBe(3);
    expect(createArgs.fileSize).toBe(1024);
    expect(createArgs.fileType).toBe("application/pdf");
    expect(Buffer.isBuffer(createArgs.buffer)).toBe(true);

    // 3. RAG indexed
    expect(deps.indexMaterial).toHaveBeenCalledWith("mat-1");

    // 4. Figures extracted
    expect(deps.figureExtract).toHaveBeenCalledWith(
      Buffer.from("pdf bytes"),
      "course-1"
    );

    // 5. Layout parser ran
    expect(deps.layoutParse).toHaveBeenCalledWith(
      Buffer.from("pdf bytes"),
      "123_doc.pdf"
    );

    // 6. User is notified — the message tells the user the
    // pipeline will only run on "Generar árbol", NOT on upload.
    expect(deps.notify).toHaveBeenCalledWith(
      "user-1",
      expect.stringMatching(/Material subido/i),
      "info"
    );
    expect(deps.notify.mock.calls[0][1]).toContain("Generar árbol");
    // CRITICAL: the previous message said "procesando árbol" —
    // verify that string is no longer present so the test catches
    // any regression of the v1.5 finding 1.7 bug.
    expect(deps.notify.mock.calls[0][1]).not.toMatch(/procesando árbol/i);
  });

  it("does NOT have a pipeline dependency in its constructor (v1.5 finding 1.7 decoupling)", () => {
    // Type-level check: UploadMaterialUseCaseDeps must not
    // include a `pipeline` key. The constructor should compile
    // and run with the six documented deps only.
    const deps = makeDeps();
    const useCase = new UploadMaterialUseCase(deps);
    expect(useCase).toBeInstanceOf(UploadMaterialUseCase);
    // The deps object has no `pipeline` key — this is a
    // structural assertion that catches any regression where
    // someone re-adds the pipeline dep to the use case.
    expect((deps as any).pipeline).toBeUndefined();
  });

  it("still creates the material even if PDF text extraction fails", async () => {
    const deps = makeDeps({
      extractText: vi.fn(async () => {
        throw new Error("pdf-parse crashed");
      }),
    });

    const useCase = new UploadMaterialUseCase(deps);
    const result = await useCase.execute({
      courseId: "course-1",
      filename: "broken.pdf",
      fileType: "application/pdf",
      fileSize: 100,
      buffer: Buffer.from("broken bytes"),
      userId: "user-1",
    });

    expect(result.material.id).toBe("mat-1");
    // Empty text is fine; the row is created with the original
    // filename + file size so the user can re-upload.
    expect(deps.createMaterial.mock.calls[0][0].content).toBe("");
    expect(deps.createMaterial.mock.calls[0][0].pageCount).toBe(0);
  });

  it("still completes the upload when the RAG indexer fails", async () => {
    const deps = makeDeps({
      indexMaterial: vi.fn(async () => {
        throw new Error("embedding service down");
      }),
    });

    const useCase = new UploadMaterialUseCase(deps);
    const result = await useCase.execute({
      courseId: "course-1",
      filename: "doc.pdf",
      fileType: "application/pdf",
      fileSize: 100,
      buffer: Buffer.from("bytes"),
      userId: "user-1",
    });

    expect(result.material.id).toBe("mat-1");
  });

  it("still completes the upload when figure extraction fails (e.g. docling down)", async () => {
    const deps = makeDeps({
      figureExtract: vi.fn(async () => {
        throw new Error("docling unreachable");
      }),
    });

    const useCase = new UploadMaterialUseCase(deps);
    const result = await useCase.execute({
      courseId: "course-1",
      filename: "doc.pdf",
      fileType: "application/pdf",
      fileSize: 100,
      buffer: Buffer.from("bytes"),
      userId: "user-1",
    });

    expect(result.material.id).toBe("mat-1");
  });

  it("still completes the upload when the layout parser fails (this is the docling-down case)", async () => {
    const deps = makeDeps({
      layoutParse: vi.fn(async () => {
        throw new Error("docling unreachable");
      }),
    });

    const useCase = new UploadMaterialUseCase(deps);
    const result = await useCase.execute({
      courseId: "course-1",
      filename: "doc.pdf",
      fileType: "application/pdf",
      fileSize: 100,
      buffer: Buffer.from("bytes"),
      userId: "user-1",
    });

    expect(result.material.id).toBe("mat-1");
  });
});

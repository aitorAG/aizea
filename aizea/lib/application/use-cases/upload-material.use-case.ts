// UploadMaterialUseCase — the "subir un PDF" use case.
//
// Responsible for the material side of the upload flow:
//   1. Extract text from the PDF (best-effort; failures are
//      non-fatal — the pipeline can still segment from layout).
//   2. Persist the file to durable storage + create the Material
//      row.
//   3. Run the RAG indexer (text chunks + embeddings) so the slides
//      and figures features can use vector search.
//   4. Run the figure extractor (best-effort; failures are
//      non-fatal).
//   5. Run the structural layout parser (best-effort; failures are
//      non-fatal — the segmenter has its own text-only fallback).
//   6. Kick off the pipeline WITH the buffer so the segmenter
//      actually has bytes to work on (this was the original bug:
//      the upload used to spawn the pipeline without the buffer).
//
// Each side-effect is its own port-friendly collaborator. The use
// case is in the application layer because it composes
// infrastructure-level collaborators into a coherent business
// operation. It depends on the IPipelineService port (NOT on
// `PipelineService` directly) so the test for this use case is a
// unit test.

import type { IMaterialRepository } from "@/lib/application/ports/material-repository.port";
import type {
  IPipelineService,
  ProcessCourseResult,
} from "@/lib/application/ports/pipeline.port";
import type { INotifier } from "@/lib/application/ports/notifier.port";
import type { Material } from "@/lib/domain/entities/material";

/** Minimal surface the use case needs from the PDF text extractor.
 *  Tests inject a fake; production wires up `PDFService`. */
export interface IPdfTextExtractor {
  extractText(buffer: Buffer): Promise<{ text: string; pages: number }>;
}

/** Minimal surface for the figure extractor. */
export interface IFigureExtractor {
  extractAndSave(
    buffer: Buffer,
    courseId: string
  ): Promise<unknown>;
}

/** Minimal surface for the layout parser. */
export interface ILayoutParser {
  parse(
    buffer: Buffer,
    filename: string
  ): Promise<{ pageCount: number } | null>;
}

/** Minimal surface for the RAG indexer. */
export interface IRagIndexer {
  indexMaterial(materialId: string): Promise<void>;
}

export interface UploadMaterialInput {
  courseId: string;
  filename: string;
  fileType: string | null;
  fileSize: number;
  buffer: Buffer;
  /** User id passed to the notifier. */
  userId: string;
}

export interface UploadMaterialOutcome {
  material: Material;
  pipelineResult: ProcessCourseResult | null;
}

export interface UploadMaterialUseCaseDeps {
  materials: IMaterialRepository;
  pipeline: IPipelineService;
  notifier: INotifier;
  pdfExtractor: IPdfTextExtractor;
  figureExtractor: IFigureExtractor;
  layoutParser: ILayoutParser;
  ragIndexer: IRagIndexer;
}

export class UploadMaterialUseCase {
  private readonly materials: IMaterialRepository;
  private readonly pipeline: IPipelineService;
  private readonly notifier: INotifier;
  private readonly pdfExtractor: IPdfTextExtractor;
  private readonly figureExtractor: IFigureExtractor;
  private readonly layoutParser: ILayoutParser;
  private readonly ragIndexer: IRagIndexer;

  constructor(deps: UploadMaterialUseCaseDeps) {
    this.materials = deps.materials;
    this.pipeline = deps.pipeline;
    this.notifier = deps.notifier;
    this.pdfExtractor = deps.pdfExtractor;
    this.figureExtractor = deps.figureExtractor;
    this.layoutParser = deps.layoutParser;
    this.ragIndexer = deps.ragIndexer;
  }

  async execute(input: UploadMaterialInput): Promise<UploadMaterialOutcome> {
    // 1. Extract text. Best-effort: if it fails (corrupt PDF,
    // non-PDF, etc.) we still persist the file + create a row
    // with empty text so the user can re-upload.
    let text = "";
    let pages = 0;
    try {
      const extracted = await this.pdfExtractor.extractText(input.buffer);
      text = extracted.text;
      pages = extracted.pages;
    } catch (err) {
      console.warn(
        "[UploadMaterialUseCase] PDF text extraction failed:",
        err instanceof Error ? err.message : err
      );
    }

    // 2. Persist file + create the Material row.
    const material = await this.materials.create({
      courseId: input.courseId,
      filename: input.filename,
      content: text,
      pageCount: pages,
      fileSize: input.fileSize,
      fileType: input.fileType,
      buffer: input.buffer,
    });

    // 3. RAG indexer (best-effort).
    try {
      await this.ragIndexer.indexMaterial(material.id);
    } catch (err) {
      console.warn(
        "[UploadMaterialUseCase] RAG indexer failed:",
        err instanceof Error ? err.message : err
      );
    }

    // 4. Figure extractor (best-effort).
    try {
      await this.figureExtractor.extractAndSave(
        input.buffer,
        input.courseId
      );
    } catch (err) {
      console.warn(
        "[UploadMaterialUseCase] figure extractor failed:",
        err instanceof Error ? err.message : err
      );
    }

    // 5. Layout parser (best-effort, fire-and-forget — the result
    // is currently not used by downstream phases, but we surface a
    // warning if it fails so docling outages are visible in logs).
    try {
      await this.layoutParser.parse(input.buffer, input.filename);
    } catch (err) {
      console.warn(
        "[UploadMaterialUseCase] layout parser failed:",
        err instanceof Error ? err.message : err
      );
    }

    // 6. Kick off the pipeline WITH the buffer so the segmenter
    // can produce SemanticUnits from the actual bytes. This is
    // the root-cause fix: previously the upload spawned the
    // pipeline with `(courseId, materialId)` and no buffer, so
    // the orchestrator fell back to "load existing units" — which
    // don't exist for a brand-new upload → `empty:true` → "sin
    // contenido que procesar". The buffer MUST be passed.
    let pipelineResult: ProcessCourseResult | null = null;
    try {
      pipelineResult = await this.pipeline.processCourse({
        courseId: input.courseId,
        materialId: material.id,
        buffer: input.buffer,
      });
    } catch (err) {
      console.warn(
        "[UploadMaterialUseCase] pipeline failed:",
        err instanceof Error ? err.message : err
      );
    }

    this.notifier.notify(
      input.userId,
      "Material subido, procesando árbol...",
      "info"
    );

    return { material, pipelineResult };
  }
}

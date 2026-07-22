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
//
// The pipeline is INTENTIONALLY NOT triggered here. v1.5 finding
// 1.7: the user wants upload to be fast (< 2s) and the pipeline
// (segmentation, extraction, integration, tree-building) to only
// run on the explicit "Generar árbol" click. Previously the upload
// use case also called `pipeline.processCourse(...)` which made
// the upload take 30s+ and fired a banner the user did not
// expect. The pipeline now runs only from `ProcessCourseUseCase`,
// which the "Generar árbol" CTA invokes.
//
// Each side-effect is its own port-friendly collaborator. The use
// case is in the application layer because it composes
// infrastructure-level collaborators into a coherent business
// operation. It does NOT depend on `IPipelineService` — the
// pipeline is owned by `ProcessCourseUseCase`.

import type { IMaterialRepository } from "@/lib/application/ports/material-repository.port";
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
}

export interface UploadMaterialUseCaseDeps {
  materials: IMaterialRepository;
  notifier: INotifier;
  pdfExtractor: IPdfTextExtractor;
  figureExtractor: IFigureExtractor;
  layoutParser: ILayoutParser;
  ragIndexer: IRagIndexer;
}

export class UploadMaterialUseCase {
  private readonly materials: IMaterialRepository;
  private readonly notifier: INotifier;
  private readonly pdfExtractor: IPdfTextExtractor;
  private readonly figureExtractor: IFigureExtractor;
  private readonly layoutParser: ILayoutParser;
  private readonly ragIndexer: IRagIndexer;

  constructor(deps: UploadMaterialUseCaseDeps) {
    this.materials = deps.materials;
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

    // Notify the user that the file is in. The pipeline only runs
    // on explicit "Generar árbol" — do NOT fire "procesando árbol"
    // here, that was the v1.5 finding 1.7 bug.
    this.notifier.notify(
      input.userId,
      "Material subido. Ve a \"Generar árbol\" para procesarlo.",
      "info"
    );

    return { material };
  }
}

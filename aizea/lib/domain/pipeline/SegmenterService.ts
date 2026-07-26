// SegmenterService — turns a DocumentStructure (from LayoutParser) into a
// list of SemanticUnit rows in the DB.
//
// Strategy:
//   - If the document has structural markup (sections), we emit one unit
//     per top-level section, using the section's content + page range.
//     Content is enriched with the section's title and any preceding text.
//   - If the document has NO structural markup, we fall back to:
//       1. Page-based units (one unit per page) when page count > 1
//       2. Paragraph-based splitting (split text on blank lines) otherwise
//     This handles scanned PDFs and pure text dumps.
//   - Empty units (whitespace-only content) are never created.
//   - Units are persisted to the DB and the resulting objects (with the
//     DB-assigned ids) are returned to the caller.
//
// The SegmenterService does NOT call the LLM. The "refine boundaries with
// LLM" step is currently a no-op (left as a future improvement); boundary
// quality is already good because Docling does the section detection.

import { LayoutParser } from "@/lib/domain/pdf/LayoutParser";
import { PDFService } from "@/lib/domain/pdf/PDFService";
import { randomUUID } from "node:crypto";
import type { SemanticUnit } from "@/lib/types/pipeline";
import type { ISegmenterRepository } from "@/lib/application/ports/segmenter-repository.port";

export interface SegmenterOptions {
  layoutParser?: LayoutParser;
  pdfService?: PDFService;
  /** If true, persist created units to the database (default: true). */
  persist?: boolean;
  /** Repositorio de persistencia (inyectado por el composition root; en
   *  tests se pasa un fake). Requerido solo cuando `persist` es true.
   *  Sustituye el antiguo acoplamiento directo a Prisma (`@/lib/db`). */
  repository?: ISegmenterRepository;
}

const MIN_CONTENT_LENGTH = 32;

export class SegmenterService {
  private readonly layoutParser: LayoutParser;
  private readonly pdfService: PDFService;
  private readonly persist: boolean;
  private readonly repository: ISegmenterRepository | undefined;

  constructor(options: SegmenterOptions = {}) {
    this.layoutParser = options.layoutParser ?? new LayoutParser();
    this.pdfService = options.pdfService ?? new PDFService();
    this.persist = options.persist ?? true;
    this.repository = options.repository;
  }

  /**
   * Segment a PDF buffer into a list of SemanticUnit rows.
   *
   * @param buffer  The raw PDF bytes.
   * @param materialId  The Material row these units belong to.
   * @returns Ordered list of persisted SemanticUnit objects.
   */
  async segment(buffer: Buffer, materialId: string): Promise<SemanticUnit[]> {
    // Try the layout-aware path first (docling-serve). If docling
    // is unreachable or returns an error, fall back to a text-only
    // segmentation. The text-only path uses pdf-parse and the raw
    // extracted text, which is always available because the upload
    // use case runs it unconditionally. This makes the segmenter
    // resilient to docling outages — the "Generar árbol" use case
    // relies on this to recover from a failed upload.
    let structure: {
      sections: Array<unknown>;
      pageCount: number;
      hasStructuralMarkup: boolean;
    } | null = null;
    // Desktop build (MSI) ships WITHOUT docling-serve: it is a heavy
    // Python service we deliberately do not bundle. The Tauri launcher
    // sets AIZEA_SKIP_DOCLING=1 so we skip the (guaranteed-to-fail)
    // Docling round-trip entirely and go straight to the pdf-parse
    // text-only path — which is fully sufficient (verified: 13 units
    // from a real PDF in ~750ms). In local/web mode the variable is
    // unset, so Docling is attempted as before for richer structure.
    const skipDocling = process.env.AIZEA_SKIP_DOCLING === "1";
    if (!skipDocling) {
      try {
        structure = await this.layoutParser.parse(buffer, `${materialId}.pdf`);
      } catch (err) {
        console.warn(
          "[SegmenterService] LayoutParser.parse failed; falling back to text-only segmentation:",
          err instanceof Error ? err.message : err
        );
        structure = null;
      }
    }

    let candidates: Array<{
      content: string;
      pageStart: number | null;
      pageEnd: number | null;
      sectionRef: string | null;
    }> = [];

    if (
      structure &&
      structure.hasStructuralMarkup &&
      structure.sections.length > 0
    ) {
      // Type narrow: structure.sections are the structural sections
      // but the helper accepts an inline-shape, so we cast.
      candidates = this.fromSections(
        structure as unknown as Parameters<SegmenterService["fromSections"]>[0]
      );
    }

    // Filter out empty / too-short candidates.
    let filtered = candidates.filter(
      (c) => c.content.trim().length >= MIN_CONTENT_LENGTH
    );

    // ROOT-CAUSE FIX for "Generar árbol → sin contenido que procesar":
    //
    // When the layout parser (docling-serve) returns section headers
    // WITHOUT their body text, `fromSections` produces candidates
    // whose `content` is just the section title and gets filtered
    // out by MIN_CONTENT_LENGTH. Without this fallback the
    // segmenter emits 0 units, the pipeline short-circuits with
    // `empty:true`, and the user sees "sin contenido que procesar"
    // even though the file has plenty of text.
    //
    // The text-only path (pdf-parse) is always available because
    // the upload use case runs it unconditionally, so falling
    // through here makes the segmenter resilient to docling
    // returning partial structures. We keep the structural attempt
    // above so the docling section boundaries are still used when
    // they DO carry body text.
    if (filtered.length === 0) {
      const pageCount = structure?.pageCount ?? 0;
      candidates = await this.fallbackFromText(buffer, pageCount);
      filtered = candidates.filter(
        (c) => c.content.trim().length >= MIN_CONTENT_LENGTH
      );
    }

    if (filtered.length === 0) {
      return [];
    }

    const now = new Date().toISOString();

    if (this.persist) {
      if (!this.repository) {
        throw new Error(
          "SegmenterService con persist=true requiere un repositorio inyectado (options.repository)."
        );
      }
      const repository = this.repository;
      // Use createMany so N units = 1 round-trip instead of N.
      // createMany in SQLite does not return inserted rows, so we
      // fetch them back ordered by order index.
      await repository.createUnits(
        filtered.map((c, i) => ({
          materialId,
          content: c.content,
          order: i,
          pageStart: c.pageStart,
          pageEnd: c.pageEnd,
          sectionRef: c.sectionRef,
        }))
      );
      const rows = await repository.findUnitsByMaterialOrdered(materialId);
      return rows.map((row) => ({
        id: row.id,
        materialId,
        content: row.content,
        order: row.order,
        pageStart: row.pageStart,
        pageEnd: row.pageEnd,
        sectionRef: row.sectionRef,
        createdAt: row.createdAt.toISOString(),
      }));
    }

    // Non-persisted path (tests / dry-run): return in-memory objects.
    return filtered.map((c, i) => ({
      id: randomUUID(),
      materialId,
      content: c.content,
      order: i,
      pageStart: c.pageStart,
      pageEnd: c.pageEnd,
      sectionRef: c.sectionRef,
      createdAt: now,
    }));
  }

  // ----- helpers -----

  private fromSections(structure: {
    sections: Array<{
      id: string;
      title: string;
      content: string;
      pageStart: number;
      pageEnd: number;
      numbering: string | null;
      level: number;
    }>;
  }) {
    // Only top-level sections (level 0). Sub-sections are merged into the
    // closest top-level ancestor's content.
    const top = structure.sections.filter((s) => s.level === 0);
    if (top.length === 0) {
      return [];
    }

    const result: Array<{
      content: string;
      pageStart: number | null;
      pageEnd: number | null;
      sectionRef: string | null;
    }> = [];

    for (let i = 0; i < top.length; i++) {
      const sec = top[i];
      const next = top[i + 1];
      const pageEnd = next ? Math.max(sec.pageEnd, next.pageStart - 1) : sec.pageEnd;

      const content = this.enrichSectionContent(sec.title, sec.content);
      if (content.trim().length === 0) continue;

      result.push({
        content,
        pageStart: sec.pageStart,
        pageEnd,
        sectionRef: sec.id,
      });
    }

    return result;
  }

  private enrichSectionContent(title: string, body: string): string {
    const trimmed = body.trim();
    if (!trimmed) {
      return title;
    }
    return `${title}\n\n${trimmed}`;
  }

  /**
   * Fallback: when the document has no structural markup, build units from
   * the raw extracted text. We try page-based splitting first (using the
   * page count from the structure), then fall back to paragraph-based
   * splitting within the whole text.
   */
  private async fallbackFromText(
    buffer: Buffer,
    pageCount: number
  ): Promise<
    Array<{
      content: string;
      pageStart: number | null;
      pageEnd: number | null;
      sectionRef: string | null;
    }>
  > {
    let text = "";
    try {
      const extracted = await this.pdfService.extractText(buffer);
      text = extracted.text;
    } catch (err) {
      console.warn(
        "[SegmenterService] fallback: failed to extract text:",
        err instanceof Error ? err.message : err
      );
      return [];
    }

    if (!text || text.trim().length === 0) {
      return [];
    }

    // Paragraph-based split: double newlines separate paragraphs.
    const paragraphs = text
      .split(/\n\s*\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length >= MIN_CONTENT_LENGTH);

    if (paragraphs.length === 0) {
      return [];
    }

    // If we have meaningful page boundaries, distribute pages evenly across
    // the paragraph chunks. Otherwise, all chunks are null-paged.
    if (pageCount > 1 && paragraphs.length > 0) {
      const perPage = Math.max(1, Math.ceil(paragraphs.length / pageCount));
      const result: Array<{
        content: string;
        pageStart: number | null;
        pageEnd: number | null;
        sectionRef: string | null;
      }> = [];
      for (let i = 0; i < paragraphs.length; i += perPage) {
        const chunk = paragraphs.slice(i, i + perPage).join("\n\n");
        const pageStart = Math.min(pageCount, Math.floor(i / perPage) + 1);
        const pageEnd = Math.min(
          pageCount,
          Math.floor((i + perPage - 1) / perPage) + 1
        );
        result.push({
          content: chunk,
          pageStart,
          pageEnd,
          sectionRef: null,
        });
      }
      return result;
    }

    // Single page: paragraph chunks, no page numbers.
    return paragraphs.map((p) => ({
      content: p,
      pageStart: pageCount > 0 ? 1 : null,
      pageEnd: pageCount > 0 ? 1 : null,
      sectionRef: null,
    }));
  }
}

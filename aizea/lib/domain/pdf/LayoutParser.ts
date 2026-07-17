// LayoutParser — wrapper around docling-serve (the MIT-licensed Docling
// project, deployed locally via docker-compose on :5001). It calls
// /v1/convert/file with multipart form-data and converts the resulting
// DoclingDocument JSON into our internal DocumentStructure shape.
//
// Why not a third-party SDK: docling-serve is a small REST API and the
// npm "docling-sdk" package targets the local Python CLI rather than
// the serve API. A 100-line typed client is simpler, more reliable and
// keeps the dependency surface tiny.

import type {
  DocumentSection,
  DocumentStructure,
  TOCEntry,
} from "@/lib/types/pipeline";

export interface LayoutParserOptions {
  baseUrl?: string;
  /** Optional fetch override (testing). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

export class DoclingUnreachableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DoclingUnreachableError";
  }
}

export class DoclingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string
  ) {
    super(message);
    this.name = "DoclingApiError";
  }
}

/** Minimal shape of a DoclingDocument JSON we rely on. */
interface DoclingDocumentJson {
  // Docling returns pages either as an array OR as an object keyed by page
  // number (as a string). Handle both.
  pages?: Array<{ page_no: number }> | Record<string, { page_no: number }>;
  body?: {
    children?: DoclingNode[];
  };
  // Section header items live in `texts` with `label === "section_header"`.
  texts?: DoclingNode[];
}

type DoclingNode = {
  self_ref?: string;
  $ref?: string;
  parent?: { $ref?: string };
  name?: string;
  label?: string;
  content_layer?: string;
  level?: number;
  text?: string;
  orig?: string;
  prov?: Array<{ page_no: number }>;
  children?: DoclingNode[];
};

// Matches a leading hierarchical number (e.g. "1", "1.2", "1.2.3") followed
// by either " " or ". " — the latter case is needed for titles like
// "1. Introduction" where a period separates the number from the title.
const NUMBERING_REGEX = /^(\d+(?:\.\d+)*)\.?\s/;

export class LayoutParser {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: LayoutParserOptions = {}) {
    const envUrl = process.env.DOCLING_SERVE_URL;
    this.baseUrl = (
      options.baseUrl ??
      envUrl ??
      "http://localhost:5001"
    ).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /** Health probe against /health. Never throws. */
  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async parse(buffer: Buffer, filename: string): Promise<DocumentStructure> {
    const document = await this.callDocling(buffer, filename);
    return this.toDocumentStructure(document, filename);
  }

  private async callDocling(
    buffer: Buffer,
    filename: string
  ): Promise<DoclingDocumentJson> {
    const form = new FormData();
    form.append("files", new Blob([new Uint8Array(buffer)]), filename);
    form.append("from_formats", "pdf");
    form.append("to_formats", "json");
    form.append("target_type", "inbody");

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/convert/file`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new DoclingUnreachableError(
        `docling-serve unreachable at ${this.baseUrl}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err
      );
    }

    if (!res.ok) {
      if (res.status >= 500) {
        throw new DoclingUnreachableError(
          `docling-serve returned ${res.status} ${res.statusText}`
        );
      }
      throw new DoclingApiError(
        `docling-serve API error: ${res.status} ${res.statusText}`,
        res.status,
        res.statusText
      );
    }

    const payload = (await res.json()) as {
      document?: { json_content?: DoclingDocumentJson };
    };
    const json = payload?.document?.json_content;
    if (!json) {
      throw new DoclingApiError(
        "docling-serve response missing document.json_content",
        res.status,
        res.statusText
      );
    }
    return json;
  }

  private toDocumentStructure(
    document: DoclingDocumentJson,
    filename: string
  ): DocumentStructure {
    const pageCount = this.countPages(document.pages);
    const headers = this.collectSectionHeaders(document);

    const sections: DocumentSection[] = headers.map((h, i) => {
      const title = (h.text ?? h.orig ?? "").trim();
      const match = NUMBERING_REGEX.exec(title);
      // Docling uses 1-based nesting levels; our DocumentSection is 0-based.
      const rawLevel = h.level ?? 1;
      return {
        id: h.self_ref ?? `sec-${i}`,
        title,
        level: Math.max(0, rawLevel - 1),
        numbering: match ? match[1] : null,
        pageStart: h.prov?.[0]?.page_no ?? 1,
        pageEnd: h.prov?.[0]?.page_no ?? 1,
        content: "",
        structural: true,
      };
    });

    const toc: TOCEntry[] = sections.map((s) => ({
      title: s.title,
      level: s.level,
      pageStart: s.pageStart,
    }));

    return {
      filename,
      pageCount,
      sections,
      toc,
      hasStructuralMarkup: sections.length > 0,
    };
  }

  private countPages(
    pages: DoclingDocumentJson["pages"]
  ): number {
    if (!pages) return 0;
    if (Array.isArray(pages)) return pages.length;
    if (typeof pages === "object") return Object.keys(pages).length;
    return 0;
  }

  /**
   * Collect section_header items from a DoclingDocument.
   * Real docling output puts them in `texts[]` with `label === "section_header"`.
   * We also walk `body.children` as a defensive fallback (older docling or
   * alternate formats).
   */
  private collectSectionHeaders(doc: DoclingDocumentJson): DoclingNode[] {
    const headers: DoclingNode[] = [];
    const seen = new Set<string>();

    const push = (n: DoclingNode): void => {
      const ref = n.self_ref ?? `${n.label}-${headers.length}`;
      if (!seen.has(ref)) {
        seen.add(ref);
        headers.push(n);
      }
    };

    // Preferred: explicit texts[] array on the document root.
    if (Array.isArray(doc.texts)) {
      for (const t of doc.texts) {
        if (t.label === "section_header") push(t);
      }
    }

    // Fallback: walk body.children tree for nested section_header nodes.
    const walk = (n: DoclingNode): void => {
      if (n.name === "section_header" || n.label === "section_header") {
        push(n);
      }
      if (n.children?.length) {
        for (const child of n.children) walk(child);
      }
    };
    if (doc.body?.children) {
      for (const c of doc.body.children) walk(c);
    }

    return headers;
  }
}

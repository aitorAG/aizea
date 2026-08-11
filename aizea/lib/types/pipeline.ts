// Pipeline types — semantic structure extracted from a document and the
// intermediate representations produced by each pipeline phase.
//
// Conventions:
//   - All fields explicit; no `any`.
//   - JSON-serializable so they can be stored as TEXT in SQLite (via JSON.stringify).
//   - IDs are application-level strings (UUID by default).
//   - Arrays use plural field names (concepts, formulas, figures).

// --- Phase 1: layout / structural analysis ---

/** A single section heading discovered in the document (or inferred). */
export interface DocumentSection {
  /** Stable identifier within the parsed document (e.g. "sec-3"). */
  id: string;
  /** Human title as it appears (e.g. "3.2 Thermodynamics"). */
  title: string;
  /** 0-based nesting level. 0 = top-level chapter. */
  level: number;
  /** Hierarchical numbering, if detected ("1.2.3"), else null. */
  numbering: string | null;
  /** Inclusive page range (1-based) covered by this section. */
  pageStart: number;
  pageEnd: number;
  /** Plain-text content of the section. */
  content: string;
  /** True if the section came from structural markup (headings), false if inferred. */
  structural: boolean;
}

/** An entry of the table of contents derived from the document. */
export interface TOCEntry {
  title: string;
  level: number;
  pageStart: number;
}

/** Output of the layout parser — what Docling + a thin mapping layer returns. */
export interface DocumentStructure {
  /** Original filename for traceability. */
  filename: string;
  /** Total number of pages detected. */
  pageCount: number;
  /** Sections in document order. Empty when the document has no structure. */
  sections: DocumentSection[];
  /** Table of contents reconstructed from headings. */
  toc: TOCEntry[];
  /** True if the PDF had explicit headings/TOC. Drives segmentation strategy. */
  hasStructuralMarkup: boolean;
}

// --- Phase 2: semantic units (segmentation) ---

/** A semantically coherent chunk of a document, produced by the SegmenterService. */
export interface SemanticUnit {
  id: string;
  materialId: string;
  content: string;
  order: number;
  pageStart: number | null;
  pageEnd: number | null;
  /** Section this unit was derived from (its id in DocumentStructure). */
  sectionRef: string | null;
  /** PR2 — breadcrumb of heading titles from the document root to this unit's
   *  section (e.g. ["Cap 3","3.2 Termodinámica"]). Empty when docling gave no
   *  structure (text-only fallback). Feeds the tree skeleton. */
  sectionPath: string[];
  createdAt: string; // ISO 8601
}

// --- Phase 3: extracted representation (LLM-driven) ---

/** A concept extracted from a unit (e.g. "entropy", "Carnot cycle"). */
export interface Concept {
  name: string;
  /** 0..1 — how central the concept is to the unit. */
  importance: number;
  /** Short definition or surface form, if any. */
  definition?: string;
}

/** A rendered formula extracted from a unit. */
export interface Formula {
  latex: string;
  /** Base64-encoded PNG of the rendered formula; empty string if rendering failed. */
  imageBase64: string;
  /** Optional caption / context in the source text. */
  context?: string;
}

/** An image / figure referenced or extracted from a unit. */
export interface Figure {
  /** Reference to a Figure row id (DB) once persisted, or a logical id before. */
  id: string;
  filename: string;
  pageNum: number | null;
  caption: string | null;
  /** Optional tags as a flat list. */
  tags: string[];
}

/** A self-contained main idea extracted from a unit. */
export interface MainIdea {
  text: string;
  /** 0..1 — confidence / salience. */
  salience: number;
}

/** Structured representation produced by the UnitExtractor for one SemanticUnit. */
export interface UnitRepresentation {
  id: string;
  unitId: string;
  concepts: Concept[];
  mainIdeas: MainIdea[];
  formulas: Formula[];
  figures: Figure[];
  /** Concept names that this unit assumes the reader already knows. */
  prerequisites: string[];
  /** Concept names that this unit introduces for the first time in the corpus. */
  introduces: string[];
  createdAt: string;
  updatedAt: string;
}

// --- Phase 4: conceptual grouping ---

/** A topic group produced by the ConceptIntegrator — a cluster of related concepts. */
export interface TopicGroup {
  id: string;
  name: string;
  description: string;
  /** 0..1 — how central this group is to the course. */
  importance: number;
  /** Concept names included in the group. */
  concepts: string[];
  /** SemanticUnit ids whose representations contributed. */
  sourceUnitIds: string[];
}

// --- Phase 5: hierarchical tree ---

/** A node in the conceptual tree of a course. Self-referencing via parentId. */
export interface TopicNode {
  id: string;
  courseId: string;
  parentId: string | null;
  name: string;
  summary: string | null;
  /** 0-based depth from the root. Roots have depth 0. */
  depth: number;
  /** v1.0 — sibling order (lower first). Basis for DFS pre-order traversal. */
  orderIndex: number;
  isLeaf: boolean;
  /** Increments on every tree rebuild / merge (rollback support). */
  version: number;
  sourceMaterialId: string | null;
  /** v1.0 — page range of this node's source content (for figure slides). */
  pageStart: number | null;
  pageEnd: number | null;
  createdAt: string;
  updatedAt: string;
}

// --- Pipeline progress ---

/** Status of a single ProcessingJob. Mirrors values written by PipelineService.
 *
 * `cancelled` is a terminal state set by the user via the
 * GlobalPipelineBanner's Stop button. It is treated like `failed` for
 * UI purposes (the user should be able to dismiss it) but is
 * semantically distinct so the action layer can tell user-stopped
 * apart from errored jobs. */
export type ProcessingStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type PipelinePhase =
  | "segmentation"
  | "extraction"
  | "integration"
  | "tree-building"
  | "merge";

/** Lightweight progress snapshot for UI polling. */
export interface PipelineProgress {
  jobId: string;
  type: PipelinePhase;
  status: ProcessingStatus;
  progress: number; // 0..100
  total: number;
  currentStep: string | null;
  error: string | null;
  courseId: string | null;
  materialId: string | null;
}

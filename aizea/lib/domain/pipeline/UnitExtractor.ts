// UnitExtractor — LLM-driven extraction of structured knowledge from a
// single SemanticUnit.
//
// Flow:
//   1. Build the prompt via PromptManager.buildExtractUnitPrompt(unit).
//   2. Call LLMClient.chatJSON(...) to get a structured response.
//   3. Render each LaTeX formula to a PNG placeholder via the latex-renderer
//      (the actual visual rendering happens in the browser via KaTeX).
//   4. Match figures from the database to the unit's page range.
//   5. Persist the resulting UnitRepresentation row in the DB and return it.
//
// Failure modes:
//   - LLM throws → propagate (JobQueue handles retry + backoff).
//   - Formula renderer returns an empty buffer (parse failure) → imageBase64
//     becomes the empty string, but the formula entry is still kept.
//   - Figures lookup fails → we silently skip; the unit still gets a
//     representation. We never block the unit on a missing figure.

import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { renderLatexToPng } from "@/lib/domain/utils/latex-renderer";
import type {
  Concept,
  Figure,
  Formula,
  MainIdea,
  SemanticUnit,
  UnitRepresentation,
} from "@/lib/types/pipeline";
import type { IUnitExtractorRepository } from "@/lib/application/ports/unit-extractor-repository.port";
import type { ILLMProvider } from "@/lib/application/ports/llm-provider.port";

export interface UnitExtractorOptions {
  promptManager?: PromptManager;
  /** Repositorio de persistencia (inyectado por el composition root; en
   *  tests se pasa un fake). Sustituye el antiguo acoplamiento directo a
   *  Prisma (`@/lib/db`). */
  repository?: IUnitExtractorRepository;
  /** Proveedor LLM inyectado por el composition root; en tests se pasa un
   *  fake. Sustituye el antiguo import de la función libre `chatJSON`. */
  llmProvider?: ILLMProvider;
}

interface LlmExtractionResponse {
  concepts?: Array<{ name: string; importance?: number; definition?: string }>;
  mainIdeas?: Array<{ text: string; salience?: number }>;
  formulas?: Array<{ latex: string; context?: string }>;
  figures?: Array<{ filename: string; pageNum?: number | null; caption?: string | null }>;
  prerequisites?: string[];
  introduces?: string[];
}

type LooseConcept = { name: string; importance?: number; definition?: string };
type LooseMainIdea = { text: string; salience?: number };
type LooseFigure = {
  filename: string;
  pageNum?: number | null;
  caption?: string | null;
};

export class UnitExtractor {
  private readonly promptManager: PromptManager;
  private readonly repository: IUnitExtractorRepository | undefined;
  private readonly llmProvider: ILLMProvider | undefined;

  constructor(options: UnitExtractorOptions = {}) {
    this.promptManager = options.promptManager ?? new PromptManager();
    this.repository = options.repository;
    this.llmProvider = options.llmProvider;
  }

  async extract(unit: SemanticUnit): Promise<UnitRepresentation> {
    if (!this.repository) {
      throw new Error(
        "UnitExtractor requiere un repositorio inyectado (options.repository)."
      );
    }
    if (!this.llmProvider) {
      throw new Error(
        "UnitExtractor requiere un proveedor LLM inyectado (options.llmProvider)."
      );
    }
    const { system, user } = this.promptManager.buildExtractUnitPrompt(unit);

    const response = await this.llmProvider.chatJSON<LlmExtractionResponse>([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    const concepts = this.normaliseConcepts(response.concepts);
    const mainIdeas = this.normaliseMainIdeas(response.mainIdeas);
    const formulas = await this.renderFormulas(response.formulas);
    const llmFigures = this.normaliseFigures(response.figures);
    const dbFigures = await this.loadFiguresForUnit(unit);

    // Merge: DB figures (matched by page) take precedence over LLM figures
    // for filename/page, but we keep LLM-supplied caption if present.
    const figures: Figure[] = this.mergeFigures(dbFigures, llmFigures);

    // Upsert (not create) so the extraction phase is idempotent. If a
    // previous pipeline run failed partway through — e.g. a later unit
    // threw — the UnitRepresentation rows already written must not cause a
    // "Unique constraint failed on unitId" crash when the user retries.
    // Re-running extraction on a unit simply refreshes its representation.
    const data = {
      concepts: JSON.stringify(concepts),
      mainIdeas: JSON.stringify(mainIdeas),
      formulas: JSON.stringify(formulas),
      figures: JSON.stringify(figures),
      prerequisites: JSON.stringify(this.normaliseNames(response.prerequisites)),
      introduces: JSON.stringify(this.normaliseNames(response.introduces)),
    };
    const row = await this.repository.upsertRepresentation(unit.id, data);

    return {
      id: row.id,
      unitId: unit.id,
      concepts,
      mainIdeas,
      formulas,
      figures,
      prerequisites: this.normaliseNames(response.prerequisites),
      introduces: this.normaliseNames(response.introduces),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  // ----- normalisers -----

  private normaliseConcepts(
    input: LlmExtractionResponse["concepts"]
  ): Concept[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((c): c is LooseConcept => !!c && typeof (c as LooseConcept).name === "string")
      .map((c) => ({
        name: c.name,
        importance:
          typeof c.importance === "number" && c.importance >= 0 && c.importance <= 1
            ? c.importance
            : 0.5,
        definition: typeof c.definition === "string" ? c.definition : undefined,
      }));
  }

  private normaliseMainIdeas(
    input: LlmExtractionResponse["mainIdeas"]
  ): MainIdea[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((m): m is LooseMainIdea => !!m && typeof (m as LooseMainIdea).text === "string")
      .map((m) => ({
        text: m.text,
        salience:
          typeof m.salience === "number" && m.salience >= 0 && m.salience <= 1
            ? m.salience
            : 0.5,
      }));
  }

  private normaliseFigures(
    input: LlmExtractionResponse["figures"]
  ): Figure[] {
    if (!Array.isArray(input)) return [];
    return input
      .filter((f): f is LooseFigure => !!f && typeof (f as LooseFigure).filename === "string")
      .map((f, idx) => ({
        id: `llm-fig-${idx}`,
        filename: f.filename,
        pageNum: typeof f.pageNum === "number" ? f.pageNum : null,
        caption: typeof f.caption === "string" ? f.caption : null,
        tags: [],
      }));
  }

  private normaliseNames(input: string[] | undefined): string[] {
    if (!Array.isArray(input)) return [];
    return input.filter((s): s is string => typeof s === "string");
  }

  private async renderFormulas(
    input: LlmExtractionResponse["formulas"]
  ): Promise<Formula[]> {
    if (!Array.isArray(input)) return [];
    const out: Formula[] = [];
    for (const f of input) {
      if (!f || typeof f.latex !== "string") continue;
      const buf = await renderLatexToPng(f.latex, { displayMode: false });
      out.push({
        latex: f.latex,
        imageBase64: buf.length > 0 ? buf.toString("base64") : "",
        context: typeof f.context === "string" ? f.context : undefined,
      });
    }
    return out;
  }

  private async loadFiguresForUnit(unit: SemanticUnit): Promise<Figure[]> {
    if (unit.pageStart == null || unit.pageEnd == null) return [];
    if (!this.repository) return [];
    const repository = this.repository;
    try {
      // Resolve the courseId from the material so we never mix figures
      // across courses (the cross-course leak bug: filtering only by pageNum
      // would return figures from any course whose pages overlap).
      const courseId = await repository.findCourseIdByMaterial(unit.materialId);
      if (!courseId) return [];

      const rows = await repository.findFiguresByPageRange(
        courseId, // CRITICAL: scope to this course only
        unit.pageStart,
        unit.pageEnd
      );
      return rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        pageNum: r.pageNum,
        caption: r.caption,
        tags: this.parseTags(r.tags),
      }));
    } catch (err) {
      console.warn(
        "[UnitExtractor] failed to load figures:",
        err instanceof Error ? err.message : err
      );
      return [];
    }
  }

  private parseTags(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  private mergeFigures(db: Figure[], llm: Figure[]): Figure[] {
    // DB figures win on id + pageNum; LLM figures add new ones that the
    // DB doesn't know about.
    const byFilename = new Map<string, Figure>();
    for (const f of db) byFilename.set(f.filename, f);
    for (const f of llm) {
      if (!byFilename.has(f.filename)) byFilename.set(f.filename, f);
    }
    return Array.from(byFilename.values());
  }
}

// Keep now referenced to silence unused-var lint if helpers change.
void (Date as unknown as { now: () => number });

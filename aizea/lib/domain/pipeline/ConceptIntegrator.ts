// ConceptIntegrator — groups the concepts extracted from every unit of a
// course into named, described TopicGroup rows.
//
// Flow:
//   1. Load every SemanticUnit for the course (via Material).
//   2. Load the UnitRepresentation for each unit.
//   3. Pre-cluster the union of all concept names by embedding cosine
//      similarity (threshold 0.7) to avoid sending the LLM thousands of
//      unrelated concepts at once.
//   4. Hand the pre-clusters to the LLM via PromptManager + LLMClient
//      and ask it to name/describe each cluster (deepseek/deepseek-chat).
//   5. Persist each named TopicGroup row and return them in DB order.
//
// Failure modes:
//   - No units / no representations → return [] (no LLM call).
//   - LLM throws → propagate (the orchestrator's ProcessingJob gets
//     marked as failed and the pipeline aborts).
//   - LLM returns groups with empty / whitespace names → silently drop
//     those (we never persist unnamed groups).
//   - importance outside [0, 1] → clamp.

import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { randomUUID } from "node:crypto";
import type { Concept, TopicGroup } from "@/lib/types/pipeline";
import type { IConceptIntegratorRepository } from "@/lib/application/ports/concept-integrator-repository.port";
import type { ILLMProvider } from "@/lib/application/ports/llm-provider.port";
import type { IEmbeddingProvider } from "@/lib/application/ports/embedding-provider.port";

/** Cosine similarity threshold for grouping two concept names together. */
const SIMILARITY_THRESHOLD = 0.7;

interface PreCluster {
  /** Stable local id for the cluster (only used in the prompt). */
  id: string;
  /** Concept names in the cluster. */
  concepts: string[];
}

interface LlmGroupResponse {
  groups: Array<{
    id?: string;
    name?: string;
    description?: string;
    importance?: number;
    concepts?: string[];
    sourceUnitIds?: string[];
  }>;
}

export interface ConceptIntegratorOptions {
  /** Proveedor de embeddings inyectado por el composition root; en tests se
   *  pasa un fake. Sustituye el antiguo `new EmbeddingService()` por defecto. */
  embeddingProvider?: IEmbeddingProvider;
  promptManager?: PromptManager;
  /** Override the similarity threshold (mostly for tests). */
  similarityThreshold?: number;
  /** Repositorio de persistencia (inyectado por el composition root; en
   *  tests se pasa un fake). Sustituye el antiguo acoplamiento directo a
   *  Prisma vía `dbOverride`. */
  repository?: IConceptIntegratorRepository;
  /** Proveedor LLM inyectado por el composition root; en tests se pasa un
   *  fake. Sustituye el antiguo import de la función libre `chatJSON`. */
  llmProvider?: ILLMProvider;
}

export class ConceptIntegrator {
  private readonly embeddingProvider: IEmbeddingProvider | undefined;
  private readonly promptManager: PromptManager;
  private readonly similarityThreshold: number;
  private readonly repository: IConceptIntegratorRepository | undefined;
  private readonly llmProvider: ILLMProvider | undefined;

  constructor(options: ConceptIntegratorOptions = {}) {
    this.embeddingProvider = options.embeddingProvider;
    this.promptManager = options.promptManager ?? new PromptManager();
    this.similarityThreshold = options.similarityThreshold ?? SIMILARITY_THRESHOLD;
    this.repository = options.repository;
    this.llmProvider = options.llmProvider;
  }

  async integrate(courseId: string): Promise<TopicGroup[]> {
    if (!this.repository) {
      throw new Error(
        "ConceptIntegrator requiere un repositorio inyectado (options.repository)."
      );
    }
    if (!this.embeddingProvider) {
      throw new Error(
        "ConceptIntegrator requiere un proveedor de embeddings inyectado (options.embeddingProvider)."
      );
    }
    if (!this.llmProvider) {
      throw new Error(
        "ConceptIntegrator requiere un proveedor LLM inyectado (options.llmProvider)."
      );
    }
    const repository = this.repository;
    const embeddingProvider = this.embeddingProvider;
    const llmProvider = this.llmProvider;

    // 1. Load all units and their representations for the course.
    const unitIds = await repository.findUnitIdsByCourse(courseId);
    if (unitIds.length === 0) {
      return [];
    }

    const representations = await repository.findRepresentationsByUnitIds(unitIds);

    if (representations.length === 0) {
      return [];
    }

    // Map: unitId → representation
    const reprByUnit = new Map<string, (typeof representations)[number]>();
    for (const r of representations) reprByUnit.set(r.unitId, r);
    void reprByUnit;

    // 2. Collect (concept name, sourceUnitId) pairs and unique names.
    //    conceptToUnits maps each concept name → set of unitIds where it appears.
    const conceptToUnits = new Map<string, Set<string>>();
    for (const r of representations) {
      const concepts = this.parseConcepts(r.concepts);
      for (const c of concepts) {
        if (!conceptToUnits.has(c.name)) {
          conceptToUnits.set(c.name, new Set());
        }
        conceptToUnits.get(c.name)!.add(r.unitId);
      }
    }

    const uniqueNames = Array.from(conceptToUnits.keys());
    if (uniqueNames.length === 0) {
      return [];
    }

    // 3. Embed every distinct concept name in a single batch.
    const embeddings = await embeddingProvider.embedBatch(uniqueNames);

    // 4. Cluster by cosine similarity.
    const clusters = this.clusterBySimilarity(uniqueNames, embeddings, this.similarityThreshold);

    // 5. Send to LLM for naming/description.
    const { system, user } = this.promptManager.buildIntegrateConceptsPrompt(
      clusters.map((c) => ({ concepts: c.concepts }))
    );
    const response = await llmProvider.chatJSON<LlmGroupResponse>([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    const groups = Array.isArray(response?.groups) ? response.groups : [];

    // 6. Normalise + persist + return.
    const persisted: TopicGroup[] = [];
    for (const g of groups) {
      const name = typeof g.name === "string" ? g.name.trim() : "";
      if (!name) continue; // drop unnamed clusters

      const description =
        typeof g.description === "string" ? g.description.trim() : "";
      const importance = this.clampImportance(g.importance);
      const concepts = Array.isArray(g.concepts)
        ? g.concepts.filter((c): c is string => typeof c === "string")
        : [];
      const sourceUnitIds = Array.isArray(g.sourceUnitIds)
        ? g.sourceUnitIds.filter((u): u is string => typeof u === "string")
        : concepts.length > 0
          ? this.unitsForConcepts(concepts, conceptToUnits)
          : [];

      const row = await repository.createTopicGroup({
        id: randomUUID(),
        courseId,
        name,
        description,
        importance,
        concepts: JSON.stringify(concepts),
        sourceUnitIds: JSON.stringify(sourceUnitIds),
        version: 1,
      });

      persisted.push({
        id: row.id,
        name: row.name,
        description: row.description,
        importance: row.importance,
        concepts,
        sourceUnitIds,
      });
    }

    return persisted;
  }

  // ----- helpers -----

  private parseConcepts(raw: string | string[] | null | undefined): Concept[] {
    if (raw == null) return [];
    // Accept either a JSON string (Prisma row) or an already-parsed array
    // (used by tests and by code paths that decoded the column first).
    let parsed: unknown;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return [];
      }
    } else {
      parsed = raw;
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (c): c is { name: string; importance?: number; definition?: string } =>
          !!c && typeof (c as { name?: unknown }).name === "string"
      )
      .map((c) => ({
        name: (c as { name: string }).name,
        importance:
          typeof (c as { importance?: number }).importance === "number"
            ? (c as { importance: number }).importance
            : 0.5,
      }));
  }

  private clusterBySimilarity(
    names: string[],
    embeddings: number[][],
    threshold: number
  ): PreCluster[] {
    if (names.length === 0) return [];
    const parent = Array.from({ length: names.length }, (_, i) => i);

    const find = (i: number): number => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    const union = (a: number, b: number): void => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    // P3 optimisation — EXACT (identical clusters), lower constant factor:
    //   1. Pre-normalise every embedding to unit length ONCE. Cosine
    //      similarity then reduces to a plain dot product in the O(n²) loop
    //      (no per-pair sqrt / norm recomputation — the old hot path did two
    //      sqrts per pair).
    //   2. Early-skip pairs already in the same cluster (union-find) so we
    //      avoid the dot product entirely once a merge is known.
    const unit = embeddings.map((v) => normalise(v));

    for (let i = 0; i < names.length; i++) {
      const vi = unit[i];
      for (let j = i + 1; j < names.length; j++) {
        // Already merged → their similarity can't change the partition.
        if (find(i) === find(j)) continue;
        if (dot(vi, unit[j]) >= threshold) {
          union(i, j);
        }
      }
    }

    const groupsByRoot = new Map<number, string[]>();
    for (let i = 0; i < names.length; i++) {
      const root = find(i);
      if (!groupsByRoot.has(root)) groupsByRoot.set(root, []);
      groupsByRoot.get(root)!.push(names[i]);
    }

    let clusterIdx = 0;
    return Array.from(groupsByRoot.values()).map((concepts) => ({
      id: `c${++clusterIdx}`,
      concepts,
    }));
  }

  private unitsForConcepts(
    concepts: string[],
    conceptToUnits: Map<string, Set<string>>
  ): string[] {
    const result = new Set<string>();
    for (const c of concepts) {
      const units = conceptToUnits.get(c);
      if (!units) continue;
      for (const u of units) result.add(u);
    }
    return Array.from(result);
  }

  private clampImportance(value: unknown): number {
    if (typeof value !== "number" || Number.isNaN(value)) return 0.5;
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Return a unit-length copy of `v`. A zero vector stays zero (its dot with
 *  anything is 0, matching cosineSimilarity's denom===0 → 0 behaviour). */
function normalise(v: number[]): number[] {
  if (!v || v.length === 0) return [];
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  const mag = Math.sqrt(norm);
  if (mag === 0) return v.slice();
  const out = new Array<number>(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / mag;
  return out;
}

/** Dot product of two equal-length vectors (0 on shape mismatch). For unit
 *  vectors this equals their cosine similarity. */
function dot(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

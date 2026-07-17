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

import { db } from "@/lib/db";
import { chatJSON } from "@/lib/domain/llm/LLMClient";
import { EmbeddingService } from "@/lib/domain/rag/EmbeddingService";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { randomUUID } from "node:crypto";
import type { Concept, TopicGroup } from "@/lib/types/pipeline";

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
  embeddingService?: EmbeddingService;
  promptManager?: PromptManager;
  /** Override the similarity threshold (mostly for tests). */
  similarityThreshold?: number;
  /** Optional injectable for the DB layer (for tests). */
  dbOverride?: typeof db;
}

export class ConceptIntegrator {
  private readonly embeddingService: EmbeddingService;
  private readonly promptManager: PromptManager;
  private readonly similarityThreshold: number;
  private readonly dbOverride: typeof db | undefined;

  constructor(options: ConceptIntegratorOptions = {}) {
    this.embeddingService = options.embeddingService ?? new EmbeddingService();
    this.promptManager = options.promptManager ?? new PromptManager();
    this.similarityThreshold = options.similarityThreshold ?? SIMILARITY_THRESHOLD;
    this.dbOverride = options.dbOverride;
  }

  async integrate(courseId: string): Promise<TopicGroup[]> {
    const dbClient = this.dbOverride ?? db;

    // 1. Load all units and their representations for the course.
    const units = await dbClient.semanticUnit.findMany({
      where: { material: { courseId } },
      include: { material: { select: { courseId: true } } },
    });
    if (units.length === 0) {
      return [];
    }

    const unitIds = units.map((u) => u.id);
    const representations = await dbClient.unitRepresentation.findMany({
      where: { unitId: { in: unitIds } },
    });

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
    const embeddings = await this.embeddingService.embedBatch(uniqueNames);

    // 4. Cluster by cosine similarity.
    const clusters = this.clusterBySimilarity(uniqueNames, embeddings, this.similarityThreshold);

    // 5. Send to LLM for naming/description.
    const { system, user } = this.promptManager.buildIntegrateConceptsPrompt(
      clusters.map((c) => ({ concepts: c.concepts }))
    );
    const response = await chatJSON<LlmGroupResponse>([
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

      const row = await dbClient.topicGroup.create({
        data: {
          id: randomUUID(),
          courseId,
          name,
          description,
          importance,
          concepts: JSON.stringify(concepts),
          sourceUnitIds: JSON.stringify(sourceUnitIds),
          version: 1,
        },
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

    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const sim = cosineSimilarity(embeddings[i], embeddings[j]);
        if (sim >= threshold) {
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

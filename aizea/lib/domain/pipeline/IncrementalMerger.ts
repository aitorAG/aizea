// IncrementalMerger — process a new material and merge its extracted
// concepts into an existing TopicNode tree.
//
// Flow:
//   1. Run segmentation + extraction on the new material (using the
//      SegmenterService and UnitExtractor wired in earlier waves).
//   2. Collect every new concept name.
//   3. Embed the new concept names + the existing TopicNode names.
//   4. For each new concept, find the best match in the existing tree
//      by cosine similarity:
//         - similarity >= 0.85 → SAME: enrich the existing node.
//         - similarity >= 0.70 → CHILD: add a new child under the
//           existing node.
//         - similarity <  0.70 → NEW: add a new root node.
//   5. Ask the LLM to validate / adjust these decisions.
//   6. Persist the new nodes with a fresh version (max(existing) + 1).
//      Old nodes are NOT deleted; their version is preserved. The
//      resulting tree is the union of old nodes (still at their old
//      version) and the new nodes (at the new version). This gives us
//      a simple rollback story — read the previous version, ignore the
//      new nodes.
//
// Failure modes:
//   - No new units / no concepts → return the existing tree unchanged.
//   - No existing tree → behave like a fresh build: create new root
//     nodes for every concept.
//   - LLM throws → propagate.

import { SegmenterService } from "@/lib/domain/pipeline/SegmenterService";
import { UnitExtractor } from "@/lib/domain/pipeline/UnitExtractor";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { randomUUID } from "node:crypto";
import type { TopicNode } from "@/lib/types/pipeline";
import type {
  IIncrementalMergerRepository,
  MergeTopicNodeRow,
} from "@/lib/application/ports/incremental-merger-repository.port";
import type { ILLMProvider } from "@/lib/application/ports/llm-provider.port";
import type { IEmbeddingProvider } from "@/lib/application/ports/embedding-provider.port";

const MATCH_THRESHOLD = 0.85;
const CHILD_THRESHOLD = 0.7;
const MAX_DEPTH = 3;

type MatchKind = "same" | "child" | "new";

interface MergeDecision {
  concept: string;
  /** Existing TopicNode id (null when kind = "new"). */
  targetId: string | null;
  kind: MatchKind;
  similarity: number;
}

interface LlmMergeResponse {
  decisions: Array<{
    concept: string;
    /** "same" | "child" | "new" — overrides the local cosine decision. */
    action: "same" | "child" | "new";
    /** Required when action is "child" or "new". */
    parentRef?: string | null;
    /** Optional new name for the cluster. */
    name?: string;
    description?: string;
  }>;
}

export interface IncrementalMergerOptions {
  segmenter?: SegmenterService;
  unitExtractor?: UnitExtractor;
  /** Proveedor de embeddings inyectado por el composition root; en tests se
   *  pasa un fake. Sustituye el antiguo `new EmbeddingService()` por defecto. */
  embeddingProvider?: IEmbeddingProvider;
  promptManager?: PromptManager;
  /** Override the match threshold (mostly for tests). */
  matchThreshold?: number;
  childThreshold?: number;
  /** Repositorio de persistencia (inyectado por el composition root; en
   *  tests se pasa un fake). Sustituye el antiguo acoplamiento directo a
   *  Prisma vía `dbOverride`. */
  repository?: IIncrementalMergerRepository;
  /** Proveedor LLM inyectado por el composition root; en tests se pasa un
   *  fake. Sustituye el antiguo import de la función libre `chatJSON`. */
  llmProvider?: ILLMProvider;
}

export class IncrementalMerger {
  private readonly segmenter: SegmenterService;
  private readonly unitExtractor: UnitExtractor;
  private readonly embeddingProvider: IEmbeddingProvider | undefined;
  private readonly promptManager: PromptManager;
  private readonly matchThreshold: number;
  private readonly childThreshold: number;
  private readonly repository: IIncrementalMergerRepository | undefined;
  private readonly llmProvider: ILLMProvider | undefined;

  constructor(options: IncrementalMergerOptions = {}) {
    this.segmenter = options.segmenter ?? new SegmenterService();
    this.unitExtractor = options.unitExtractor ?? new UnitExtractor();
    this.embeddingProvider = options.embeddingProvider;
    this.promptManager = options.promptManager ?? new PromptManager();
    this.matchThreshold = options.matchThreshold ?? MATCH_THRESHOLD;
    this.childThreshold = options.childThreshold ?? CHILD_THRESHOLD;
    this.repository = options.repository;
    this.llmProvider = options.llmProvider;
  }

  async merge(
    courseId: string,
    newMaterialId: string,
    buffer: Buffer
  ): Promise<TopicNode[]> {
    if (!this.repository) {
      throw new Error(
        "IncrementalMerger requiere un repositorio inyectado (options.repository)."
      );
    }
    if (!this.embeddingProvider) {
      throw new Error(
        "IncrementalMerger requiere un proveedor de embeddings inyectado (options.embeddingProvider)."
      );
    }
    if (!this.llmProvider) {
      throw new Error(
        "IncrementalMerger requiere un proveedor LLM inyectado (options.llmProvider)."
      );
    }
    const repository = this.repository;
    const embeddingProvider = this.embeddingProvider;
    const llmProvider = this.llmProvider;

    // 1. Process the new material. The buffer is REQUIRED: previously
    // we passed `Buffer.from([])`, which silently produced zero
    // SemanticUnits and made the merge a no-op for any newly uploaded
    // material. The buffer is the only way for the segmenter to know
    // what the new material actually contains.
    const newUnits = await this.segmenter.segment(buffer, newMaterialId);
    const newRepresentations: Array<{
      unitId: string;
      concepts: Array<{ name: string; importance?: number }>;
    }> = [];
    for (const u of newUnits) {
      const rep = await this.unitExtractor.extract(u);
      newRepresentations.push({
        unitId: u.id,
        concepts: rep.concepts.map((c) => ({ name: c.name, importance: c.importance })),
      });
    }

    // 2. Load the existing tree.
    const existingRows = await repository.findNodesByCourse(courseId);
    const existing: TopicNode[] = existingRows.map((r) => ({
      id: r.id,
      courseId: r.courseId,
      parentId: r.parentId,
      name: r.name,
      summary: r.summary,
      depth: r.depth,
      isLeaf: r.isLeaf,
      version: r.version,
      sourceMaterialId: r.sourceMaterialId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    // 3. Collect unique new concept names.
    const conceptSet = new Set<string>();
    for (const r of newRepresentations) {
      for (const c of r.concepts) conceptSet.add(c.name);
    }
    const newConcepts = Array.from(conceptSet);

    // 4. Short-circuit: nothing to merge.
    if (newConcepts.length === 0) {
      return existing;
    }

    // 5. Embed new concepts + existing node names.
    const allText = [...newConcepts, ...existing.map((n) => n.name)];
    const vectors = await embeddingProvider.embedBatch(allText);
    const newVectors = vectors.slice(0, newConcepts.length);
    const existingVectors = vectors.slice(newConcepts.length);

    // 6. Compute decisions by cosine similarity.
    const decisions: MergeDecision[] = newConcepts.map((c, i) => {
      const best = this.findBestMatch(
        newVectors[i],
        existing,
        existingVectors
      );
      let kind: MatchKind = "new";
      if (best.similarity >= this.matchThreshold) kind = "same";
      else if (best.similarity >= this.childThreshold) kind = "child";
      return {
        concept: c,
        targetId: best.id,
        kind,
        similarity: best.similarity,
      };
    });

    // 7. Validate with the LLM (best-effort — if it throws, we keep the
    //    local cosine decisions and skip validation rather than failing
    //    the whole merge).
    let validated: MergeDecision[] = decisions;
    try {
      validated = await this.validateWithLlm(decisions, existing);
    } catch (err) {
      console.warn(
        "[IncrementalMerger] LLM validation failed, falling back to cosine decisions:",
        err instanceof Error ? err.message : err
      );
    }

    // 8. Persist new nodes (kind = "child" or "new") with a new version.
    //    Old nodes are NOT touched.
    const previousVersion = await repository.findLatestVersion(courseId);
    const newVersion = (previousVersion ?? 0) + 1;

    const persisted: TopicNode[] = [...existing];
    for (const d of validated) {
      if (d.kind === "same") {
        // Enrich the existing node (no row-level change; presence in the
        // returned tree is enough for callers that build their tree from
        // the latest version of each node).
        continue;
      }

      if (d.kind === "child" && d.targetId) {
        const parent = existing.find((n) => n.id === d.targetId);
        if (!parent || parent.depth >= MAX_DEPTH) {
          // Promote to a root if parent is too deep.
          const row = await this.createRootNode(
            repository,
            courseId,
            d.concept,
            newVersion,
            newMaterialId
          );
          persisted.push(row);
        } else {
          const row = await repository.createNode({
            courseId,
            parentId: parent.id,
            name: d.concept,
            summary: null,
            depth: parent.depth + 1,
            isLeaf: true,
            version: newVersion,
            sourceMaterialId: newMaterialId,
          });
          persisted.push({
            id: row.id,
            courseId: row.courseId,
            parentId: row.parentId,
            name: row.name,
            summary: row.summary,
            depth: row.depth,
            isLeaf: row.isLeaf,
            version: row.version,
            sourceMaterialId: row.sourceMaterialId,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          });
        }
      } else {
        // "new" — create a new root node.
        const row = await this.createRootNode(
          repository,
          courseId,
          d.concept,
          newVersion,
          newMaterialId
        );
        persisted.push(row);
      }
    }

    return persisted;
  }

  // ----- helpers -----

  private findBestMatch(
    vector: number[],
    candidates: TopicNode[],
    candidateVectors: number[][]
  ): { id: string | null; similarity: number } {
    let bestId: string | null = null;
    let bestSim = -1;
    for (let i = 0; i < candidates.length; i++) {
      const sim = cosineSimilarity(vector, candidateVectors[i]);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = candidates[i].id;
      }
    }
    return { id: bestId, similarity: bestSim };
  }

  private async validateWithLlm(
    decisions: MergeDecision[],
    existing: TopicNode[]
  ): Promise<MergeDecision[]> {
    if (!this.llmProvider) {
      throw new Error(
        "IncrementalMerger requiere un proveedor LLM inyectado (options.llmProvider)."
      );
    }
    const { system, user } = this.promptManager.buildIntegrateConceptsPrompt(
      decisions.map((d) => ({ concepts: [d.concept] }))
    );
    const response = await this.llmProvider.chatJSON<LlmMergeResponse>([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    if (!response || !Array.isArray(response.decisions)) {
      return decisions;
    }
    // Map LLM decisions back onto our local decisions by concept name.
    const llmByName = new Map(
      response.decisions.map((d) => [d.concept, d])
    );
    return decisions.map((d) => {
      const llm = llmByName.get(d.concept);
      if (!llm) return d;
      const action = llm.action ?? "new";
      let targetId: string | null = d.targetId;
      if (action === "child" && llm.parentRef) {
        const match = existing.find((n) => n.id === llm.parentRef);
        if (match) targetId = match.id;
      } else if (action === "same" && d.targetId) {
        targetId = d.targetId;
      } else if (action === "new") {
        targetId = null;
      }
      return { ...d, kind: action, targetId };
    });
  }

  private async createRootNode(
    repository: IIncrementalMergerRepository,
    courseId: string,
    name: string,
    version: number,
    sourceMaterialId: string
  ): Promise<TopicNode> {
    const row: MergeTopicNodeRow = await repository.createNode({
      id: randomUUID(),
      courseId,
      parentId: null,
      name,
      summary: null,
      depth: 0,
      isLeaf: true,
      version,
      sourceMaterialId,
    });
    return {
      id: row.id,
      courseId: row.courseId,
      parentId: row.parentId,
      name: row.name,
      summary: row.summary,
      depth: row.depth,
      isLeaf: row.isLeaf,
      version: row.version,
      sourceMaterialId: row.sourceMaterialId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
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

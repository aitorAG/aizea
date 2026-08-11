// TreeBuilder — organises a course's TopicGroups into a 2-4 level
// hierarchy persisted as TopicNode rows with self-referencing parentId.
//
// Flow:
//   1. Load all TopicGroup rows for the course.
//   2. Ask the LLM to organise them into a hierarchy (via the
//      build-tree prompt). The LLM returns a JSON object with
//      { nodes: [...], roots: [...] } where each node has a local
//      "ref" (either a TopicGroup id like "g-1" or a synthetic id
//      "n1"/"n2") and a "parentRef" (or null for roots).
//   3. Resolve the refs to actual TopicNode ids we create in the DB.
//   4. Validate the hierarchy: no cycles, no orphan refs, max depth 3
//      (i.e. up to 4 levels: root → child → grandchild → great-grandchild).
//   5. Persist the new nodes under a new version number (last + 1).
//      Old nodes for the course are deleted (the previous version
//      remains queryable from the versioned history column if a caller
//      saved a snapshot before the rebuild).
//
// Failure modes:
//   - No TopicGroups → return [] without LLM call.
//   - LLM throws → propagate.
//   - Cycle in the hierarchy → throw (this is a hard error, not a
//     soft skip; an invalid tree would be unrecoverable).
//   - Node refers to a non-existent parentRef → throw (orphan).

import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { TreeSkeletonBuilder } from "@/lib/domain/pipeline/tree-skeleton";
import type { TopicGroup, TopicNode } from "@/lib/types/pipeline";
import type {
  BatchTopicNodeInput,
  ITreeBuilderRepository,
} from "@/lib/application/ports/tree-builder-repository.port";
import type { ITreeSkeletonBuilder } from "@/lib/application/ports/tree-skeleton.port";
import type { ILLMProvider } from "@/lib/application/ports/llm-provider.port";

const MAX_DEPTH = 3; // depth 0..3 = 4 levels

/** PR3 — tree construction strategy.
 *  - "structure": derive the hierarchy from the document's heading structure
 *    (sectionPath), falling back to "llm" when no structure is available.
 *  - "llm": ask the LLM to organise the groups from scratch (legacy path).
 *  Controlled by AIZEA_TREE_STRATEGY or the `strategy` option. */
export type TreeStrategy = "structure" | "llm";

function resolveTreeStrategy(): TreeStrategy {
  return process.env.AIZEA_TREE_STRATEGY === "llm" ? "llm" : "structure";
}

interface LlmHierarchyResponse {
  nodes: Array<{
    ref: string;
    name: string;
    summary?: string;
    parentRef?: string | null;
    depth: number;
  }>;
  roots: string[];
}

interface ResolvedNode {
  ref: string;
  name: string;
  summary: string;
  parentRef: string | null;
  depth: number;
  /** Temporary id assigned during resolution; replaced with DB id at create time. */
  tempId: string;
}

export interface TreeBuilderOptions {
  promptManager?: PromptManager;
  /** Repositorio de persistencia (inyectado por el composition root; en
   *  tests se pasa un fake). Sustituye el antiguo acoplamiento directo a
   *  Prisma vía `dbOverride`. */
  repository?: ITreeBuilderRepository;
  /** Proveedor LLM inyectado por el composition root; en tests se pasa un
   *  fake. Sustituye el antiguo import de la función libre `chatJSON`. */
  llmProvider?: ILLMProvider;
  /** PR3 — estrategia de construcción. Default: env AIZEA_TREE_STRATEGY o
   *  "structure". */
  strategy?: TreeStrategy;
  /** PR3 — constructor del esqueleto (camino "structure"). Default:
   *  TreeSkeletonBuilder. */
  skeletonBuilder?: ITreeSkeletonBuilder;
}

export class TreeBuilder {
  private readonly promptManager: PromptManager;
  private readonly repository: ITreeBuilderRepository | undefined;
  private readonly llmProvider: ILLMProvider | undefined;
  private readonly strategy: TreeStrategy;
  private readonly skeletonBuilder: ITreeSkeletonBuilder;

  constructor(options: TreeBuilderOptions = {}) {
    this.promptManager = options.promptManager ?? new PromptManager();
    this.repository = options.repository;
    this.llmProvider = options.llmProvider;
    this.strategy = options.strategy ?? resolveTreeStrategy();
    this.skeletonBuilder = options.skeletonBuilder ?? new TreeSkeletonBuilder();
  }

  async build(courseId: string): Promise<TopicNode[]> {
    if (!this.repository) {
      throw new Error(
        "TreeBuilder requiere un repositorio inyectado (options.repository)."
      );
    }
    const repository = this.repository;

    // 1. Load TopicGroups for the course (shared by both strategies).
    const groupRows = await repository.findTopicGroupsByCourse(courseId);
    if (groupRows.length === 0) return [];

    const groups: TopicGroup[] = groupRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      importance: r.importance,
      concepts: this.parseStringArray(r.concepts),
      sourceUnitIds: this.parseStringArray(r.sourceUnitIds),
    }));

    // 2. Dispatch by strategy. The "structure" path derives the hierarchy
    //    from the document headings; when there is no heading structure it
    //    returns null and we fall back to the LLM path. This is why the
    //    legacy LLM tests (groups with empty sourceUnitIds) keep working.
    if (this.strategy === "structure") {
      const viaStructure = await this.buildViaStructure(
        courseId,
        groups,
        repository
      );
      if (viaStructure !== null) return viaStructure;
    }

    return this.buildViaLlm(courseId, groups, repository);
  }

  // ----- strategy: LLM (legacy) -----

  private async buildViaLlm(
    courseId: string,
    groups: TopicGroup[],
    repository: ITreeBuilderRepository
  ): Promise<TopicNode[]> {
    if (!this.llmProvider) {
      throw new Error(
        "TreeBuilder requiere un proveedor LLM inyectado (options.llmProvider)."
      );
    }
    const llmProvider = this.llmProvider;

    // 2. Ask the LLM to build the hierarchy.
    const { system, user } = this.promptManager.buildBuildTreePrompt(groups);
    const response = await llmProvider.chatJSON<LlmHierarchyResponse>([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    const nodesInput = Array.isArray(response?.nodes) ? response.nodes : [];
    if (nodesInput.length === 0) return [];

    // 3. Resolve the parent references to actual DB ids.
    const resolved = this.resolveHierarchy(nodesInput);

    // 4. Validate: depth, cycles, orphan refs.
    this.assertValidHierarchy(resolved);

    // 5. Compute next version.
    const previousVersion = await repository.findLatestVersion(courseId);
    const nextVersion = (previousVersion ?? 0) + 1;

    // 6. Delete old nodes for the course (full rebuild).
    await repository.deleteNodesByCourse(courseId);

    // 7. Persist. We must insert in topological order so parentId always
    //    resolves. The resolver already produced a DFS-ordered list with
    //    parents before children. After each insert, we remember the
    //    mapping from the LLM's local "ref" to the database id so we
    //    can resolve parentRef at insert time.
    const refToDbId = new Map<string, string>();
    const persisted: TopicNode[] = [];
    // Per-parent sibling counter → orderIndex. `resolved` is DFS pre-ordered,
    // so siblings are encountered in their intended order.
    const siblingCounter = new Map<string, number>();
    for (const n of resolved) {
      const dbParentId = n.parentRef !== null ? refToDbId.get(n.parentRef) ?? null : null;
      const isLeaf = !resolved.some((other) => other.parentRef === n.ref);
      const parentKey = n.parentRef ?? "__root__";
      const orderIndex = siblingCounter.get(parentKey) ?? 0;
      siblingCounter.set(parentKey, orderIndex + 1);
      const row = await repository.createNode({
        courseId,
        parentId: dbParentId,
        name: n.name,
        summary: n.summary,
        depth: n.depth,
        orderIndex,
        isLeaf,
        version: nextVersion,
        sourceMaterialId: null,
      });
      refToDbId.set(n.ref, row.id);
      persisted.push({
        id: row.id,
        courseId: row.courseId,
        parentId: row.parentId,
        name: row.name,
        summary: row.summary,
        depth: row.depth,
        orderIndex: row.orderIndex,
        isLeaf: row.isLeaf,
        version: row.version,
        sourceMaterialId: row.sourceMaterialId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }
    return persisted;
  }

  // ----- strategy: structure (headings as ground-truth) -----

  /**
   * Build the tree from the document's heading structure. Returns null when
   * there is no usable structure (no sectionPaths) so the caller falls back
   * to the LLM path.
   *
   * Steps:
   *   1. Gather the sectionPaths of every unit referenced by the groups.
   *   2. Build a skeleton (headings → hierarchy, depth derived) — the tree's
   *      backbone, no LLM.
   *   3. Hang each group as a leaf under the skeleton node matching its most
   *      frequent section (clamped to MAX_DEPTH).
   *   4. Persist atomically (build-before-delete) in one transaction.
   */
  private async buildViaStructure(
    courseId: string,
    groups: TopicGroup[],
    repository: ITreeBuilderRepository
  ): Promise<TopicNode[] | null> {
    // 1. Collect every referenced unit id, then load unit → sectionPath.
    const allUnitIds = new Set<string>();
    for (const g of groups) for (const u of g.sourceUnitIds) allUnitIds.add(u);
    if (allUnitIds.size === 0) return null; // no provenance → fall back to LLM

    const rows = await repository.findSectionPathsByUnitIds(
      Array.from(allUnitIds)
    );
    const pathByUnit = new Map<string, string[]>();
    for (const r of rows) {
      pathByUnit.set(r.unitId, this.parseStringArray(r.sectionPath));
    }

    // 2. Build the skeleton from all non-empty section paths.
    const allPaths = Array.from(pathByUnit.values()).filter(
      (p) => p.length > 0
    );
    if (allPaths.length === 0) return null; // structure absent → fall back

    const skeleton = this.skeletonBuilder.fromSectionPaths(allPaths);
    if (skeleton.length === 0) return null;

    // Skeleton ref = section title. Index by ref for parent/depth lookups.
    const skeletonByRef = new Map(skeleton.map((s) => [s.ref, s]));

    const previousVersion = await repository.findLatestVersion(courseId);
    const nextVersion = (previousVersion ?? 0) + 1;

    // 3. Assemble batch nodes. Skeleton nodes first (topological), each ref
    //    prefixed to avoid colliding with group refs.
    const skeletonPrefix = "sk:";
    const groupPrefix = "grp:";
    const batch: BatchTopicNodeInput[] = [];

    for (const s of skeleton) {
      batch.push({
        tempRef: skeletonPrefix + s.ref,
        parentTempRef: s.parentRef !== null ? skeletonPrefix + s.parentRef : null,
        name: s.name,
        summary: "",
        depth: s.depth,
        orderIndex: 0, // assigned in the sibling-order pass below
        isLeaf: false, // fixed up below
        version: nextVersion,
        sourceMaterialId: null,
      });
    }

    // 3b. Hang each group under the skeleton node for its dominant section.
    for (const g of groups) {
      const sectionRef = this.dominantSection(g, pathByUnit);
      const parentSkeleton =
        sectionRef !== null ? skeletonByRef.get(sectionRef) : undefined;

      let parentTempRef: string | null;
      let depth: number;
      if (parentSkeleton && parentSkeleton.depth < MAX_DEPTH) {
        parentTempRef = skeletonPrefix + parentSkeleton.ref;
        depth = parentSkeleton.depth + 1;
      } else if (parentSkeleton) {
        // Parent is at max depth: attach the group AT the section (sibling
        // depth) instead of exceeding MAX_DEPTH.
        parentTempRef = parentSkeleton.parentRef
          ? skeletonPrefix + parentSkeleton.parentRef
          : null;
        depth = parentSkeleton.depth;
      } else {
        // No matching section → the group becomes a root.
        parentTempRef = null;
        depth = 0;
      }

      batch.push({
        tempRef: groupPrefix + g.id,
        parentTempRef,
        name: g.name,
        summary: g.description ?? "",
        depth,
        orderIndex: 0, // assigned in the sibling-order pass below
        isLeaf: true, // groups are always leaves in this strategy
        version: nextVersion,
        sourceMaterialId: null,
      });
    }

    // 3c. Fix isLeaf on skeleton nodes: a skeleton node is a leaf only if
    //     nothing (skeleton child or group) hangs under it.
    const hasChild = new Set<string>();
    for (const n of batch) {
      if (n.parentTempRef !== null) hasChild.add(n.parentTempRef);
    }
    for (const n of batch) {
      if (n.tempRef.startsWith(skeletonPrefix)) {
        n.isLeaf = !hasChild.has(n.tempRef);
      }
    }

    // 3d. Assign orderIndex per parent from batch position (skeleton nodes are
    //     topologically ordered; groups follow). Siblings get 0,1,2… in the
    //     order they appear — the basis for the DFS pre-order traversal.
    const siblingCounter = new Map<string, number>();
    for (const n of batch) {
      const parentKey = n.parentTempRef ?? "__root__";
      const idx = siblingCounter.get(parentKey) ?? 0;
      n.orderIndex = idx;
      siblingCounter.set(parentKey, idx + 1);
    }

    // 4. Persist atomically and map back to TopicNode[].
    const created = await repository.replaceCourseNodes(courseId, batch);
    return created.map((row) => ({
      id: row.id,
      courseId: row.courseId,
      parentId: row.parentId,
      name: row.name,
      summary: row.summary,
      depth: row.depth,
      orderIndex: row.orderIndex,
      isLeaf: row.isLeaf,
      version: row.version,
      sourceMaterialId: row.sourceMaterialId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  /** The section (skeleton ref = leaf title) most frequently associated with a
   *  group's source units. Null when none of its units has a section path. */
  private dominantSection(
    group: TopicGroup,
    pathByUnit: Map<string, string[]>
  ): string | null {
    const tally = new Map<string, number>();
    for (const unitId of group.sourceUnitIds) {
      const path = pathByUnit.get(unitId);
      if (!path || path.length === 0) continue;
      const leaf = path[path.length - 1]; // deepest heading = the section
      tally.set(leaf, (tally.get(leaf) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [leaf, count] of tally) {
      if (count > bestCount) {
        bestCount = count;
        best = leaf;
      }
    }
    return best;
  }

  // ----- hierarchy resolution -----

  private resolveHierarchy(input: LlmHierarchyResponse["nodes"]): ResolvedNode[] {
    // First pass: collect refs and assign temp ids to the nodes that have
    // refs starting with "n" (synthetic). Refs starting with "g" are
    // existing TopicGroup ids and will be used as-is for parent lookups
    // — but in the resolved output, we replace the "ref" with the actual
    // generated TopicNode id from the database.
    //
    // For simplicity we treat the ref as a key the LLM controls and we
    // map it to a stable identifier in the resolved graph. We do not
    // pre-create the TopicNode ids; the database assigns them at create
    // time. Instead we expose `parentRef` in the resolved graph and let
    // the persistence loop translate refs → ids.

    // Build the node list with all internal refs intact.
    const byRef = new Map<string, ResolvedNode>();
    for (const n of input) {
      if (!n || typeof n.ref !== "string") continue;
      if (byRef.has(n.ref)) continue; // dedupe
      byRef.set(n.ref, {
        ref: n.ref,
        name: typeof n.name === "string" ? n.name : n.ref,
        summary: typeof n.summary === "string" ? n.summary : "",
        parentRef:
          typeof n.parentRef === "string" && n.parentRef.length > 0
            ? n.parentRef
            : null,
        depth: typeof n.depth === "number" ? n.depth : 0,
        tempId: n.ref, // ref doubles as the local id during resolve
      });
    }

    // Topological order (parents before children) via DFS.
    const ordered: ResolvedNode[] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (ref: string, chain: string[]): void => {
      if (visited.has(ref)) return;
      if (chain.includes(ref)) {
        throw new Error(
          `Ciclo detectado en jerarquía: ${chain.join(" → ")} → ${ref}`
        );
      }
      const node = byRef.get(ref);
      if (!node) return; // orphan ref — handled separately below
      visiting.add(ref);
      if (node.parentRef) {
        visit(node.parentRef, [...chain, ref]);
      }
      visiting.delete(ref);
      visited.add(ref);
      ordered.push(node);
    };

    for (const ref of Array.from(byRef.keys())) {
      visit(ref, []);
    }

    return ordered;
  }

  private assertValidHierarchy(resolved: ResolvedNode[]): void {
    if (resolved.length === 0) return;

    // Max depth.
    for (const n of resolved) {
      if (n.depth > MAX_DEPTH) {
        throw new Error(
          `Profundidad máxima (${MAX_DEPTH}) superada por nodo "${n.name}" (depth=${n.depth})`
        );
      }
    }

    // Orphan refs.
    const refs = new Set(resolved.map((n) => n.ref));
    for (const n of resolved) {
      if (n.parentRef !== null && !refs.has(n.parentRef)) {
        throw new Error(
          `Referencia huérfana en nodo "${n.name}": parentRef "${n.parentRef}" no existe`
        );
      }
    }

    // Cycle detection via DFS with chain tracking. The resolver already
    // rejects immediate cycles, but we run an additional safety pass.
    const color = new Map<string, 0 | 1 | 2>(); // 0=white, 1=gray, 2=black
    const path: string[] = [];
    for (const n of resolved) color.set(n.ref, 0);

    const dfs = (ref: string): void => {
      const c = color.get(ref) ?? 0;
      if (c === 2) return;
      if (c === 1) {
        throw new Error(
          `Ciclo detectado en jerarquía: ${path.join(" → ")} → ${ref}`
        );
      }
      color.set(ref, 1);
      path.push(ref);
      const node = resolved.find((n) => n.ref === ref);
      if (node?.parentRef) dfs(node.parentRef);
      path.pop();
      color.set(ref, 2);
    };

    for (const n of resolved) {
      if (color.get(n.ref) === 0) dfs(n.ref);
    }
  }

  private parseStringArray(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((s): s is string => typeof s === "string");
    } catch {
      return [];
    }
  }
}

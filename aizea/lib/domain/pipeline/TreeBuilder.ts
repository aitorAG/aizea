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

import { db } from "@/lib/db";
import { chatJSON } from "@/lib/domain/llm/LLMClient";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import type { TopicGroup, TopicNode } from "@/lib/types/pipeline";

const MAX_DEPTH = 3; // depth 0..3 = 4 levels

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
  /** Optional injectable for the DB layer (for tests). */
  dbOverride?: typeof db;
}

export class TreeBuilder {
  private readonly promptManager: PromptManager;
  private readonly dbOverride: typeof db | undefined;

  constructor(options: TreeBuilderOptions = {}) {
    this.promptManager = options.promptManager ?? new PromptManager();
    this.dbOverride = options.dbOverride;
  }

  async build(courseId: string): Promise<TopicNode[]> {
    const dbClient = this.dbOverride ?? db;

    // 1. Load TopicGroups for the course.
    const groupRows = await dbClient.topicGroup.findMany({
      where: { courseId },
    });
    if (groupRows.length === 0) return [];

    const groups: TopicGroup[] = groupRows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      importance: r.importance,
      concepts: this.parseStringArray(r.concepts),
      sourceUnitIds: this.parseStringArray(r.sourceUnitIds),
    }));

    // 2. Ask the LLM to build the hierarchy.
    const { system, user } = this.promptManager.buildBuildTreePrompt(groups);
    const response = await chatJSON<LlmHierarchyResponse>([
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
    const previous = await dbClient.topicNode.findFirst({
      where: { courseId },
      orderBy: { version: "desc" },
    });
    const nextVersion = (previous?.version ?? 0) + 1;

    // 6. Delete old nodes for the course (full rebuild).
    await dbClient.topicNode.deleteMany({ where: { courseId } });

    // 7. Persist. We must insert in topological order so parentId always
    //    resolves. The resolver already produced a DFS-ordered list with
    //    parents before children. After each insert, we remember the
    //    mapping from the LLM's local "ref" to the database id so we
    //    can resolve parentRef at insert time.
    const refToDbId = new Map<string, string>();
    const persisted: TopicNode[] = [];
    for (const n of resolved) {
      const dbParentId = n.parentRef !== null ? refToDbId.get(n.parentRef) ?? null : null;
      const isLeaf = !resolved.some((other) => other.parentRef === n.ref);
      const row = await dbClient.topicNode.create({
        data: {
          courseId,
          parentId: dbParentId,
          name: n.name,
          summary: n.summary,
          depth: n.depth,
          isLeaf,
          version: nextVersion,
          sourceMaterialId: null,
        },
      });
      refToDbId.set(n.ref, row.id);
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
    return persisted;
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

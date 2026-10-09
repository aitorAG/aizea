import { db } from "@/lib/db";
import { chatJSON } from "@/lib/infrastructure/ai/llm-client";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import type { SubcontentProposal } from "@/lib/domain/prompts/templates/split-subcontents.template";
import type { TopicNode } from "@/lib/types/pipeline";
import type { PrismaClient } from "@prisma/client";
import { assignnumericPaths } from "@/lib/domain/tree/tree-numbering";

/**
 * TreeService — responsabilidad ÚNICA: manipulación del árbol de TopicNode de
 * un curso (leer, editar, borrar con reparentado, fusionar, dividir con IA,
 * añadir).
 *
 * Extraído de `lib/actions/tree.ts` (fichero-dios de 472 líneas que mezclaba
 * lógica de dominio con concerns de server-action) como parte de la Fase 1 del
 * plan de reescritura selectiva (CA-7). Las server actions quedan como
 * envoltorios finos que solo añaden `revalidatePath` y traducen al tipo
 * público.
 *
 * Cada método devuelve una unión discriminada `{ ok, ... }` para que el
 * envoltorio no tenga que lanzar en fallos conocidos. En éxito, incluye el
 * `courseId` afectado para que la action pueda invalidar la caché.
 */

// ---------- result types (internos: incluyen courseId para revalidación) ----------

export type TreeReadResult =
  | { ok: true; tree: TopicNode[] }
  | { ok: false; error: string };

export type TreeNodeResult =
  | { ok: true; node: TopicNode; courseId: string }
  | { ok: false; error: string };

export type TreeDeleteResult =
  | { ok: true; courseId: string }
  | { ok: false; error: string };

export type TreeSplitResult =
  | { ok: true; nodes: TopicNode[]; courseId: string }
  | { ok: false; error: string };

// ---------- helpers ----------

function toTopicNode(row: {
  id: string;
  courseId: string;
  parentId: string | null;
  name: string;
  summary: string | null;
  depth: number;
  orderIndex: number;
  numericPath?: string | null;
  displayOrder?: number | null;
  sourceMaterialIds?: string;
  isLeaf: boolean;
  version: number;
  sourceMaterialId: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  createdAt: Date;
  updatedAt: Date;
}): TopicNode {
  return {
    id: row.id,
    courseId: row.courseId,
    parentId: row.parentId,
    name: row.name,
    summary: row.summary,
    depth: row.depth,
    orderIndex: row.orderIndex,
    numericPath: row.numericPath ?? undefined,
    displayOrder: row.displayOrder ?? undefined,
    sourceMaterialIds: row.sourceMaterialIds ? JSON.parse(row.sourceMaterialIds) : [],
    isLeaf: row.isLeaf,
    version: row.version,
    sourceMaterialId: row.sourceMaterialId,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Hard limits on the number of children a single Split can produce.
// The LLM is asked for 2-5 but we clamp defensively in case it returns more.
const SPLIT_MIN_CHILDREN = 1;
const SPLIT_MAX_CHILDREN = 5;

// v0.11.0 — Incremental expansion ("Bajar nivel"):
// - A leaf is only expanded when the LLM proposes at least this many distinct
//   subcontents. Below the threshold the leaf is LEFT INTACT (never cloned to
//   itself), so an expansion never produces meaningless duplicate nodes.
const EXPAND_MIN_CHILDREN = 2;
// - Hard safety ceiling on tree depth. A leaf already at this depth is skipped
//   (not an error for the whole operation), so expansion degrades gracefully.
const MAX_TREE_DEPTH = 6;

/**
 * Normalise a single sub-content entry coming back from the LLM.
 * Trims strings, drops empty names, clamps summary length. Returns
 * null when the entry is unusable.
 */
function normaliseSubcontent(
  raw: unknown
): { name: string; summary: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" ? r.name.trim() : "";
  if (name.length === 0) return null;
  const summaryRaw = typeof r.summary === "string" ? r.summary.trim() : "";
  const summary = summaryRaw.slice(0, 400);
  return { name: name.slice(0, 120), summary };
}

export interface UpdateTreeNodeInput {
  name?: string;
  summary?: string | null;
}

export interface AddTreeNodeInput {
  name: string;
  summary?: string | null;
}

export class TreeService {
  constructor(
    private database: PrismaClient = db,
    private promptManager: PromptManager = new PromptManager(),
    private llmChatJSON: typeof chatJSON = chatJSON
  ) {}

  /**
   * Ask the LLM to propose 2-5 sub-contents for the given node. The shape is
   * validated and clamped; an empty array means the response was unusable
   * (caller falls back to a single child). Wrapped in try/catch so a transient
   * network error surfaces as a clean empty result.
   */
  private async proposeSubcontents(
    nodeName: string,
    nodeSummary: string | null
  ): Promise<{ name: string; summary: string }[]> {
    try {
      const { system, user } = this.promptManager.buildSplitSubcontentsPrompt(
        nodeName,
        nodeSummary
      );
      const response = await this.llmChatJSON<{ subcontents?: SubcontentProposal[] }>([
        { role: "system", content: system },
        { role: "user", content: user },
      ]);
      if (!response || !Array.isArray(response.subcontents)) return [];
      const cleaned: { name: string; summary: string }[] = [];
      for (const raw of response.subcontents) {
        const entry = normaliseSubcontent(raw);
        if (entry) cleaned.push(entry);
        if (cleaned.length >= SPLIT_MAX_CHILDREN) break;
      }
      return cleaned;
    } catch (err) {
      console.warn("[tree] proposeSubcontents: LLM call failed, using fallback", err);
      return [];
    }
  }

  /** Read the entire TopicNode tree for a course. */
  async getCourseTree(courseId: string): Promise<TreeReadResult> {
    const course = await this.database.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return { ok: false, error: "Curso no encontrado." };
    }
    const rows = await this.database.topicNode.findMany({ where: { courseId } });
    return { ok: true, tree: rows.map(toTopicNode) };
  }

  /** Edit a node's name and/or summary. Bumps the node's version. */
  async updateTreeNode(
    nodeId: string,
    data: UpdateTreeNodeInput
  ): Promise<TreeNodeResult> {
    const existing = await this.database.topicNode.findUnique({ where: { id: nodeId } });
    if (!existing) {
      return { ok: false, error: "Nodo no encontrado." };
    }
    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (trimmed.length === 0) {
        return { ok: false, error: "El nombre no puede estar vacío." };
      }
    }
    const updated = await this.database.topicNode.update({
      where: { id: nodeId },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.summary !== undefined ? { summary: data.summary } : {}),
        version: existing.version + 1,
      },
    });
    return { ok: true, node: toTopicNode(updated), courseId: existing.courseId };
  }

  /**
   * Update ONLY the `summary` field of a single TopicNode. An empty string is
   * normalised to `null` so the column never stores a meaningless "".
   */
  async updateTopicNodeSummary(
    nodeId: string,
    summary: string | null
  ): Promise<TreeNodeResult> {
    const existing = await this.database.topicNode.findUnique({ where: { id: nodeId } });
    if (!existing) {
      return { ok: false, error: "Nodo no encontrado." };
    }
    const normalised =
      summary === null
        ? null
        : summary.trim().length === 0
          ? null
          : summary.trim();
    const updated = await this.database.topicNode.update({
      where: { id: nodeId },
      data: { summary: normalised, version: existing.version + 1 },
    });
    return { ok: true, node: toTopicNode(updated), courseId: existing.courseId };
  }

  /**
   * Delete a node. Its direct children are reattached to the deleted node's
   * parent (or become roots). Depths are normalised in a second pass.
   */
  async deleteTreeNode(nodeId: string): Promise<TreeDeleteResult> {
    const target = await this.database.topicNode.findUnique({ where: { id: nodeId } });
    if (!target) {
      return { ok: false, error: "Nodo no encontrado." };
    }
    const newParentId = target.parentId;

    await this.database.$transaction(async (tx) => {
      // 1. Reassign direct children to the deleted node's parent (updateMany — no N+1).
      await tx.topicNode.updateMany({
        where: { parentId: nodeId },
        data: { parentId: newParentId },
      });

      // 2. Delete the node.
      await tx.topicNode.delete({ where: { id: nodeId } });

      // 3. Normalise depths of reattached children so the tree invariant holds.
      const newParentDepth = newParentId
        ? ((await tx.topicNode.findUnique({ where: { id: newParentId } }))?.depth ?? -1)
        : -1;
      const expectedDepth = newParentDepth + 1;
      await tx.topicNode.updateMany({
        where: {
          parentId: newParentId,
          courseId: target.courseId,
          depth: { not: expectedDepth },
        },
        data: { depth: expectedDepth },
      });
    });

    // v0.11.0 — keep hierarchical numbering current after a structural change
    // (R2.2). Deleting a node shifts sibling indices, so numericPath must be
    // recomputed for the whole course.
    await this.recalculateTreeNumbering(target.courseId);

    return { ok: true, courseId: target.courseId };
  }

  /**
   * Merge several sibling nodes into a single new node under the given parent.
   * The original siblings are deleted; their children are reattached.
   */
  async mergeTreeNodes(
    parentId: string,
    childIds: string[],
    name: string
  ): Promise<TreeNodeResult> {
    if (childIds.length === 0) {
      return { ok: false, error: "Debe proporcionar al menos un nodo." };
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "El nombre no puede estar vacío." };
    }
    const parent = await this.database.topicNode.findUnique({ where: { id: parentId } });
    if (!parent) {
      return { ok: false, error: "Padre no encontrado." };
    }
    const children = await this.database.topicNode.findMany({
      where: { id: { in: childIds } },
    });
    if (children.length !== childIds.length) {
      return { ok: false, error: "Uno o más nodos no existen." };
    }

    const newNode = await this.database.$transaction(async (tx) => {
      const grandchildren = await tx.topicNode.findMany({
        where: { parentId: { in: childIds } },
        select: { id: true },
      });
      const grandchildIds = grandchildren.map((g) => g.id);

      const created = await tx.topicNode.create({
        data: {
          courseId: parent.courseId,
          parentId: parent.id,
          name: trimmed,
          summary: null,
          depth: parent.depth + 1,
          isLeaf: grandchildIds.length === 0,
          version: (parent.version ?? 1) + 1,
          sourceMaterialId: null,
        },
      });

      if (grandchildIds.length > 0) {
        await tx.topicNode.updateMany({
          where: { id: { in: grandchildIds } },
          data: { parentId: created.id },
        });
      }

      await tx.topicNode.deleteMany({ where: { id: { in: childIds } } });

      return created;
    });

    // v0.11.0 — recompute numbering after merge (R2.2).
    await this.recalculateTreeNumbering(parent.courseId);

    return { ok: true, node: toTopicNode(newNode), courseId: parent.courseId };
  }

  /**
   * Split a node into N children based on the content. The LLM proposes 2-5
   * sub-contents; one child per proposal. On LLM failure, falls back to a
   * single child carrying the original content. The original node is kept as
   * a non-leaf container.
   */
  async splitTreeNode(nodeId: string): Promise<TreeSplitResult> {
    const target = await this.database.topicNode.findUnique({ where: { id: nodeId } });
    if (!target) {
      return { ok: false, error: "Nodo no encontrado." };
    }
    // v0.11.0 — unify the depth ceiling with the "Bajar nivel" expansion
    // (MAX_TREE_DEPTH). Previously "Dividir" capped at depth 3 while expansion
    // allowed 6, an inconsistency where a node reachable by expansion could
    // not be split.
    if (target.depth >= MAX_TREE_DEPTH) {
      return {
        ok: false,
        error: "No se puede dividir un nodo en el nivel máximo de profundidad.",
      };
    }

    const proposed = await this.proposeSubcontents(target.name, target.summary);

    const children =
      proposed.length >= SPLIT_MIN_CHILDREN
        ? proposed
        : [{ name: target.name, summary: target.summary ?? "" }];

    const childData = children.map((child) => ({
      courseId: target.courseId,
      parentId: target.id,
      name: child.name,
      summary: child.summary.length > 0 ? child.summary : null,
      depth: target.depth + 1,
      isLeaf: true,
      version: target.version + 1,
      sourceMaterialId: target.sourceMaterialId,
    }));

    const created = await this.database.$transaction(async (tx) => {
      await tx.topicNode.createMany({ data: childData });
      await tx.topicNode.update({
        where: { id: target.id },
        data: { isLeaf: false, version: target.version + 1 },
      });
      return tx.topicNode.findMany({
        where: { parentId: target.id },
        orderBy: { createdAt: "asc" },
      });
    });

    // v0.11.0 — recompute numbering after split (R2.2). New children need
    // numericPath, and the parent transitions from leaf to branch.
    await this.recalculateTreeNumbering(target.courseId);

    return { ok: true, nodes: created.map(toTopicNode), courseId: target.courseId };
  }

  /**
   * Add a new node to the tree. `parentId` may be null to create a root.
   * The new node's depth is computed from its parent.
   */
  async addTreeNode(
    courseId: string,
    parentId: string | null,
    data: AddTreeNodeInput
  ): Promise<TreeNodeResult> {
    const course = await this.database.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return { ok: false, error: "Curso no encontrado." };
    }
    const trimmed = data.name.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "El nombre no puede estar vacío." };
    }
    let depth = 0;
    let parentCourseId = courseId;
    if (parentId) {
      const parent = await this.database.topicNode.findUnique({ where: { id: parentId } });
      if (!parent) {
        return { ok: false, error: "Padre no encontrado." };
      }
      if (parent.courseId !== courseId) {
        return { ok: false, error: "El padre no pertenece al curso." };
      }
      depth = parent.depth + 1;
      parentCourseId = parent.courseId;
    }
    const created = await this.database.topicNode.create({
      data: {
        courseId: parentCourseId,
        parentId,
        name: trimmed,
        summary: data.summary ?? null,
        depth,
        isLeaf: true,
        version: 1,
        sourceMaterialId: null,
      },
    });

    // v0.11.0 — recompute numbering so the newly added node (and any siblings
    // whose index shifted) get a correct numericPath immediately (R2.2).
    await this.recalculateTreeNumbering(parentCourseId);
    const numbered = await this.database.topicNode.findUnique({ where: { id: created.id } });

    return { ok: true, node: toTopicNode(numbered ?? created), courseId: parentCourseId };
  }

  /**
   * Recalculates hierarchical numbering for all TopicNodes in a course.
   * Assigns numericPath (e.g., "1.2.3") and displayOrder (DFS pre-order index).
   * 
   * Should be called after:
   * - Tree construction (pipeline)
   * - Adding/deleting/moving nodes
   * - Any operation that changes tree structure
   * 
   * @returns Number of nodes updated
   */
  async recalculateTreeNumbering(courseId: string): Promise<number> {
    const nodes = await this.database.topicNode.findMany({
      where: { courseId },
      select: {
        id: true,
        parentId: true,
        orderIndex: true,
      },
    });

    if (nodes.length === 0) return 0;

    const numbering = assignnumericPaths(nodes);

    // Batch update all nodes with their new hierarchical numbers
    await this.database.$transaction(
      numbering.map((n) =>
        this.database.topicNode.update({
          where: { id: n.id },
          data: {
            numericPath: n.numericPath,
            displayOrder: n.displayOrder,
          },
        })
      )
    );

    return numbering.length;
  }

  /**
   * v0.11.0 — Incremental leaf expansion (shared core for "Bajar nivel").
   *
   * STRICTLY ADDITIVE: for each provided leaf, asks the LLM for subcontents and
   * creates them as children, flipping the leaf to a branch. It NEVER deletes,
   * rebuilds, moves or clones existing nodes, so the user's prior work is always
   * preserved.
   *
   * A leaf is only expanded when the LLM proposes at least EXPAND_MIN_CHILDREN
   * distinct subcontents. Otherwise the leaf is left intact (no self-clone).
   * A leaf already at MAX_TREE_DEPTH is skipped (graceful degradation).
   *
   * @returns number of nodes actually created.
   */
  private async expandLeaves(
    leaves: {
      id: string;
      courseId: string;
      name: string;
      summary: string | null;
      depth: number;
      version: number;
      sourceMaterialId: string | null;
    }[]
  ): Promise<number> {
    let addedCount = 0;

    // Sequential to avoid overwhelming the LLM provider.
    for (const leaf of leaves) {
      if (leaf.depth >= MAX_TREE_DEPTH) {
        // Already at the safety ceiling — skip, don't abort the whole run.
        continue;
      }

      const proposed = await this.proposeSubcontents(leaf.name, leaf.summary);

      // Anti-clone guard: only expand when the LLM proposes a meaningful
      // subdivision. Below the threshold the leaf stays a leaf.
      if (proposed.length < EXPAND_MIN_CHILDREN) {
        continue;
      }

      const childData = proposed.map((child) => ({
        courseId: leaf.courseId,
        parentId: leaf.id,
        name: child.name,
        summary: child.summary.length > 0 ? child.summary : null,
        depth: leaf.depth + 1,
        isLeaf: true,
        version: 1,
        sourceMaterialId: leaf.sourceMaterialId,
      }));

      await this.database.$transaction(async (tx) => {
        await tx.topicNode.createMany({ data: childData });
        await tx.topicNode.update({
          where: { id: leaf.id },
          data: { isLeaf: false, version: leaf.version + 1 },
        });
      });

      addedCount += childData.length;
    }

    return addedCount;
  }

  /**
   * v0.11.0 — "Bajar nivel" with NO selection: expand every leaf at the
   * DEEPEST level of the tree (the leaves of the leaves). For each such leaf,
   * generate as many child sub-leaves as the content warrants.
   *
   * Incremental and additive — existing nodes are never removed. Returns the
   * FULL updated tree (not just the new nodes) so the client can render the
   * complete state without losing the user's prior work.
   */
  async expandTreeDepth(
    courseId: string
  ): Promise<{ ok: true; nodes: TopicNode[]; courseId: string; addedCount: number } | { ok: false; error: string }> {
    const course = await this.database.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return { ok: false, error: "Curso no encontrado." };
    }

    const leafNodes = await this.database.topicNode.findMany({
      where: { courseId, isLeaf: true },
    });

    if (leafNodes.length === 0) {
      return { ok: false, error: "No hay nodos hoja para expandir." };
    }

    // Expand ONLY the leaves at the deepest level (the most granular row).
    const maxDepth = Math.max(...leafNodes.map((n) => n.depth));
    const deepestLeaves = leafNodes.filter((n) => n.depth === maxDepth);

    if (maxDepth >= MAX_TREE_DEPTH) {
      return {
        ok: false,
        error: "El árbol ya alcanzó la profundidad máxima permitida.",
      };
    }

    const addedCount = await this.expandLeaves(deepestLeaves);

    if (addedCount === 0) {
      return {
        ok: false,
        error:
          "No se pudieron generar subniveles significativos para las hojas actuales.",
      };
    }

    // Recompute hierarchical numbering so new nodes are numbered correctly.
    await this.recalculateTreeNumbering(courseId);

    // Return the FULL updated tree (additive merge on the client).
    const rows = await this.database.topicNode.findMany({ where: { courseId } });
    return { ok: true, nodes: rows.map(toTopicNode), courseId, addedCount };
  }

  /**
   * v0.11.0 — "Bajar nivel" with a SELECTION: expand only the selected leaves.
   * For each selected leaf, generate as many child sub-leaves as warranted.
   *
   * Incremental and additive. Returns the FULL updated tree.
   */
  async expandSelectedNodesDepth(
    courseId: string,
    selectedNodeIds: string[]
  ): Promise<{ ok: true; nodes: TopicNode[]; courseId: string; addedCount: number } | { ok: false; error: string }> {
    if (selectedNodeIds.length === 0) {
      return { ok: false, error: "No hay nodos seleccionados para expandir." };
    }

    const course = await this.database.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return { ok: false, error: "Curso no encontrado." };
    }

    // Only leaf nodes among the selected IDs can be expanded.
    const leafNodes = await this.database.topicNode.findMany({
      where: {
        courseId,
        id: { in: selectedNodeIds },
        isLeaf: true,
      },
    });

    if (leafNodes.length === 0) {
      return { ok: false, error: "Ninguno de los nodos seleccionados es una hoja." };
    }

    const addedCount = await this.expandLeaves(leafNodes);

    if (addedCount === 0) {
      return {
        ok: false,
        error:
          "No se pudieron generar subniveles significativos para las hojas seleccionadas.",
      };
    }

    await this.recalculateTreeNumbering(courseId);

    const rows = await this.database.topicNode.findMany({ where: { courseId } });
    return { ok: true, nodes: rows.map(toTopicNode), courseId, addedCount };
  }
}

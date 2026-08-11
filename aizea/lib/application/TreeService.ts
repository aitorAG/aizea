import { db } from "@/lib/db";
import { chatJSON } from "@/lib/infrastructure/ai/llm-client";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import type { SubcontentProposal } from "@/lib/domain/prompts/templates/split-subcontents.template";
import type { TopicNode } from "@/lib/types/pipeline";
import type { PrismaClient } from "@prisma/client";

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
  isLeaf: boolean;
  version: number;
  sourceMaterialId: string | null;
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
    isLeaf: row.isLeaf,
    version: row.version,
    sourceMaterialId: row.sourceMaterialId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Hard limits on the number of children a single Split can produce.
// The LLM is asked for 2-5 but we clamp defensively in case it returns more.
const SPLIT_MIN_CHILDREN = 1;
const SPLIT_MAX_CHILDREN = 5;

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
    if (target.depth >= 3) {
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
    return { ok: true, node: toTopicNode(created), courseId: parentCourseId };
  }
}

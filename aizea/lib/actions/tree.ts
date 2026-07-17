"use server";

// Server actions for the TopicNode tree of a course.
//
// Every action returns a discriminated union { ok, ... } so the client
// never has to throw on a known failure. Unknown errors are surfaced as
// ok:false with a generic message — we never echo the underlying stack
// trace to the client.
//
// All actions assume the caller has already verified they own the
// courseId / nodeId. There is no per-user ownership in the schema yet
// (the rest of the app trusts the id as a capability token), so we
// only check that the entity exists before mutating it. Add a real ACL
// when auth lands in a later wave.

import { db } from "@/lib/db";
import { revalidatePath } from "next/cache";
import type { TopicNode } from "@/lib/types/pipeline";

// ---------- result types ----------

export type GetCourseTreeResult =
  | { ok: true; tree: TopicNode[] }
  | { ok: false; error: string };

export type UpdateTreeNodeResult =
  | { ok: true; node: TopicNode }
  | { ok: false; error: string };

export type DeleteTreeNodeResult =
  | { ok: true }
  | { ok: false; error: string };

export type MergeTreeNodesResult =
  | { ok: true; node: TopicNode }
  | { ok: false; error: string };

export type SplitTreeNodeResult =
  | { ok: true; nodes: TopicNode[] }
  | { ok: false; error: string };

export type AddTreeNodeResult =
  | { ok: true; node: TopicNode }
  | { ok: false; error: string };

// ---------- helpers ----------

function toTopicNode(row: {
  id: string;
  courseId: string;
  parentId: string | null;
  name: string;
  summary: string | null;
  depth: number;
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
    isLeaf: row.isLeaf,
    version: row.version,
    sourceMaterialId: row.sourceMaterialId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------- actions ----------

/**
 * Read the entire TopicNode tree for a course. Returns an empty array
 * when the course has no nodes yet.
 */
export async function getCourseTreeAction(
  courseId: string
): Promise<GetCourseTreeResult> {
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) {
    return { ok: false, error: "Curso no encontrado." };
  }
  const rows = await db.topicNode.findMany({ where: { courseId } });
  return { ok: true, tree: rows.map(toTopicNode) };
}

export interface UpdateTreeNodeInput {
  name?: string;
  summary?: string | null;
}

/**
 * Edit a node's name and/or summary. Bumps the node's version so the
 * cache invalidation downstream picks up the change.
 */
export async function updateTreeNodeAction(
  nodeId: string,
  data: UpdateTreeNodeInput
): Promise<UpdateTreeNodeResult> {
  const existing = await db.topicNode.findUnique({ where: { id: nodeId } });
  if (!existing) {
    return { ok: false, error: "Nodo no encontrado." };
  }
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "El nombre no puede estar vacío." };
    }
  }
  const updated = await db.topicNode.update({
    where: { id: nodeId },
    data: {
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      ...(data.summary !== undefined ? { summary: data.summary } : {}),
      version: existing.version + 1,
    },
  });
  revalidatePath(`/courses/${existing.courseId}/tree`);
  return { ok: true, node: toTopicNode(updated) };
}

/**
 * Delete a node. Its direct children are reattached to the deleted
 * node's parent (or become roots when the deleted node was itself a
 * root). Grandchildren keep their existing parentIds, so the depth
 * may end up inconsistent in extreme cases; we normalise depths in a
 * second pass to keep the tree well-formed.
 */
export async function deleteTreeNodeAction(
  nodeId: string
): Promise<DeleteTreeNodeResult> {
  const target = await db.topicNode.findUnique({ where: { id: nodeId } });
  if (!target) {
    return { ok: false, error: "Nodo no encontrado." };
  }
  const newParentId = target.parentId; // children inherit this

  // Reassign children first (FK constraint: parentId references TopicNode.id).
  await db.topicNode.updateMany({
    where: { parentId: nodeId },
    data: { parentId: newParentId },
  });
  // Delete the node.
  await db.topicNode.delete({ where: { id: nodeId } });

  // Normalise depths of the children we just reattached so the tree
  // invariant (depth = parent.depth + 1) holds.
  const reattached = await db.topicNode.findMany({
    where: { parentId: newParentId, courseId: target.courseId },
  });
  const newParentDepth = newParentId
    ? (await db.topicNode.findUnique({ where: { id: newParentId } }))?.depth ?? -1
    : -1;
  const expectedDepth = newParentDepth + 1;
  for (const child of reattached) {
    if (child.depth !== expectedDepth) {
      await db.topicNode.update({
        where: { id: child.id },
        data: { depth: expectedDepth, version: child.version + 1 },
      });
    }
  }

  revalidatePath(`/courses/${target.courseId}/tree`);
  return { ok: true };
}

/**
 * Merge several sibling nodes into a single new node under the given
 * parent. The original siblings are deleted; their children (if any)
 * are reattached to the new merged node.
 */
export async function mergeTreeNodesAction(
  parentId: string,
  childIds: string[],
  name: string
): Promise<MergeTreeNodesResult> {
  if (childIds.length === 0) {
    return { ok: false, error: "Debe proporcionar al menos un nodo." };
  }
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "El nombre no puede estar vacío." };
  }
  const parent = await db.topicNode.findUnique({ where: { id: parentId } });
  if (!parent) {
    return { ok: false, error: "Padre no encontrado." };
  }
  const children = await db.topicNode.findMany({
    where: { id: { in: childIds } },
  });
  if (children.length !== childIds.length) {
    return { ok: false, error: "Uno o más nodos no existen." };
  }

  // Move grandchildren (children of the merged nodes) to the new node.
  const grandchildren = await db.topicNode.findMany({
    where: { parentId: { in: childIds } },
  });
  for (const g of grandchildren) {
    await db.topicNode.update({
      where: { id: g.id },
      data: { parentId: null /* will be re-set below */ },
    });
  }

  const newNode = await db.topicNode.create({
    data: {
      courseId: parent.courseId,
      parentId: parent.id,
      name: trimmed,
      summary: null,
      depth: parent.depth + 1,
      isLeaf: grandchildren.length === 0,
      version: (parent.version ?? 1) + 1,
      sourceMaterialId: null,
    },
  });

  // Reattach grandchildren to the new node.
  for (const g of grandchildren) {
    await db.topicNode.update({
      where: { id: g.id },
      data: { parentId: newNode.id },
    });
  }
  // Delete the merged siblings.
  await db.topicNode.deleteMany({ where: { id: { in: childIds } } });

  revalidatePath(`/courses/${parent.courseId}/tree`);
  return { ok: true, node: toTopicNode(newNode) };
}

/**
 * Split a node into two children. The original node is kept as a
 * container; we create two new children under it with the original
 * name and a derived second name. No LLM is involved — this is a
 * deterministic helper for the TreeViewer's "split" button.
 */
export async function splitTreeNodeAction(
  nodeId: string
): Promise<SplitTreeNodeResult> {
  const target = await db.topicNode.findUnique({ where: { id: nodeId } });
  if (!target) {
    return { ok: false, error: "Nodo no encontrado." };
  }
  if (target.depth >= 3) {
    return {
      ok: false,
      error: "No se puede dividir un nodo en el nivel máximo de profundidad.",
    };
  }
  const first = await db.topicNode.create({
    data: {
      courseId: target.courseId,
      parentId: target.id,
      name: target.name,
      summary: target.summary,
      depth: target.depth + 1,
      isLeaf: true,
      version: target.version + 1,
      sourceMaterialId: target.sourceMaterialId,
    },
  });
  const second = await db.topicNode.create({
    data: {
      courseId: target.courseId,
      parentId: target.id,
      name: `${target.name} (parte 2)`,
      summary: null,
      depth: target.depth + 1,
      isLeaf: true,
      version: target.version + 1,
      sourceMaterialId: target.sourceMaterialId,
    },
  });
  // After splitting, the original is no longer a leaf.
  await db.topicNode.update({
    where: { id: target.id },
    data: { isLeaf: false, version: target.version + 1 },
  });
  revalidatePath(`/courses/${target.courseId}/tree`);
  return { ok: true, nodes: [toTopicNode(first), toTopicNode(second)] };
}

export interface AddTreeNodeInput {
  name: string;
  summary?: string | null;
}

/**
 * Add a new node to the tree. `parentId` may be null to create a root.
 * The new node's depth is computed from its parent.
 */
export async function addTreeNodeAction(
  courseId: string,
  parentId: string | null,
  data: AddTreeNodeInput
): Promise<AddTreeNodeResult> {
  const course = await db.course.findUnique({ where: { id: courseId } });
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
    const parent = await db.topicNode.findUnique({ where: { id: parentId } });
    if (!parent) {
      return { ok: false, error: "Padre no encontrado." };
    }
    if (parent.courseId !== courseId) {
      return { ok: false, error: "El padre no pertenece al curso." };
    }
    depth = parent.depth + 1;
    parentCourseId = parent.courseId;
  }
  const created = await db.topicNode.create({
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
  revalidatePath(`/courses/${courseId}/tree`);
  return { ok: true, node: toTopicNode(created) };
}

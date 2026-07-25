"use server";

// Server actions for the TopicNode tree of a course.
//
// Envoltorios finos sobre `TreeService` (lib/application/TreeService.ts). La
// lógica de dominio (manipulación del árbol, split con IA, normalización de
// profundidad) vive en el servicio; aquí solo añadimos `revalidatePath` y
// traducimos al tipo público (que no expone `courseId`).
//
// Every action returns a discriminated union { ok, ... } so the client never
// has to throw on a known failure. Unknown errors are surfaced as ok:false
// with a generic message — we never echo the underlying stack trace.
//
// All actions assume the caller has already verified they own the
// courseId / nodeId. There is no per-user ownership in the schema yet.

import { revalidatePath } from "next/cache";
import { TreeService } from "@/lib/application/TreeService";
import type { TopicNode } from "@/lib/types/pipeline";

const treeService = new TreeService();

// ---------- result types (públicos, sin courseId) ----------

export type GetCourseTreeResult =
  | { ok: true; tree: TopicNode[] }
  | { ok: false; error: string };

export type UpdateTreeNodeResult =
  | { ok: true; node: TopicNode }
  | { ok: false; error: string };

/**
 * Result of a single-field summary update. Kept as its own type (instead of
 * reusing `UpdateTreeNodeResult`) so the inline summary editor in `TreeNode`
 * can narrow on `ok` without confusing the caller about which fields changed.
 */
export type UpdateTopicNodeSummaryResult =
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

export interface UpdateTreeNodeInput {
  name?: string;
  summary?: string | null;
}

export interface AddTreeNodeInput {
  name: string;
  summary?: string | null;
}

// ---------- actions ----------

/**
 * Read the entire TopicNode tree for a course. Returns an empty array when the
 * course has no nodes yet.
 */
export async function getCourseTreeAction(
  courseId: string
): Promise<GetCourseTreeResult> {
  return treeService.getCourseTree(courseId);
}

/**
 * Edit a node's name and/or summary. Bumps the node's version so the cache
 * invalidation downstream picks up the change.
 */
export async function updateTreeNodeAction(
  nodeId: string,
  data: UpdateTreeNodeInput
): Promise<UpdateTreeNodeResult> {
  const result = await treeService.updateTreeNode(nodeId, data);
  if (!result.ok) return result;
  revalidatePath(`/courses/${result.courseId}/tree`);
  return { ok: true, node: result.node };
}

/**
 * Update ONLY the `summary` field of a single TopicNode. The slide generation
 * pipeline reads this field as the high-level content of the box, so it is the
 * primary authoring surface after the tree has been bootstrapped.
 */
export async function updateTopicNodeSummaryAction(
  nodeId: string,
  summary: string | null
): Promise<UpdateTopicNodeSummaryResult> {
  const result = await treeService.updateTopicNodeSummary(nodeId, summary);
  if (!result.ok) return result;
  revalidatePath(`/courses/${result.courseId}/tree`);
  return { ok: true, node: result.node };
}

/**
 * Delete a node. Its direct children are reattached to the deleted node's
 * parent (or become roots when the deleted node was itself a root).
 */
export async function deleteTreeNodeAction(
  nodeId: string
): Promise<DeleteTreeNodeResult> {
  const result = await treeService.deleteTreeNode(nodeId);
  if (!result.ok) return result;
  revalidatePath(`/courses/${result.courseId}/tree`);
  return { ok: true };
}

/**
 * Merge several sibling nodes into a single new node under the given parent.
 * The original siblings are deleted; their children are reattached.
 */
export async function mergeTreeNodesAction(
  parentId: string,
  childIds: string[],
  name: string
): Promise<MergeTreeNodesResult> {
  const result = await treeService.mergeTreeNodes(parentId, childIds, name);
  if (!result.ok) return result;
  revalidatePath(`/courses/${result.courseId}/tree`);
  return { ok: true, node: result.node };
}

/**
 * Split a node into N children based on the content. The LLM proposes 2-5
 * sub-contents; one child per proposal. Falls back to a single child if the
 * LLM is unavailable. The original node is kept as a non-leaf container.
 */
export async function splitTreeNodeAction(
  nodeId: string
): Promise<SplitTreeNodeResult> {
  const result = await treeService.splitTreeNode(nodeId);
  if (!result.ok) return result;
  revalidatePath(`/courses/${result.courseId}/tree`);
  return { ok: true, nodes: result.nodes };
}

/**
 * Add a new node to the tree. `parentId` may be null to create a root. The new
 * node's depth is computed from its parent.
 */
export async function addTreeNodeAction(
  courseId: string,
  parentId: string | null,
  data: AddTreeNodeInput
): Promise<AddTreeNodeResult> {
  const result = await treeService.addTreeNode(courseId, parentId, data);
  if (!result.ok) return result;
  revalidatePath(`/courses/${courseId}/tree`);
  return { ok: true, node: result.node };
}

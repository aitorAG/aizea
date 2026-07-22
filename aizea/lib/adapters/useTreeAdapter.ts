"use client";

import { useCallback, useMemo, useState } from "react";
import type { Edge, Node } from "reactflow";
import type { TopicNode } from "@/lib/types/pipeline";
import {
  updateTreeNodeAction,
  deleteTreeNodeAction,
  mergeTreeNodesAction,
  splitTreeNodeAction,
  addTreeNodeAction,
  type UpdateTreeNodeInput,
  type AddTreeNodeInput,
} from "@/lib/actions/tree";

// The data we attach to every ReactFlow node so the custom renderer can
// draw the right tile. Kept narrow on purpose — anything visual the
// TreeNode component needs lives here.
export interface TreeFlowNodeData extends Record<string, unknown> {
  name: string;
  summary: string | null;
  depth: number;
  isLeaf: boolean;
  version: number;
  sourceMaterialId: string | null;
  // Optional enrichment — the adapter fills these from the optional
  // counts argument so the tree can show concept/slide counts without
  // the renderer needing to do its own queries.
  conceptCount?: number;
  slideCount?: number;
  // F4.1 — multi-checkbox selection. The TreeViewer owns the
  // selection state (a Set<string>) and pushes it down to every
  // node via these two fields. The TreeNode renders a dedicated
  // checkbox that calls onSelectToggle; the visual state comes
  // from `selected`. Keeping the source of truth in the parent
  // means click handlers don't have to fight with ReactFlow's
  // built-in selection model.
  selected?: boolean;
  onSelectToggle?: () => void;
  // F4.2 — hover tooltip. The parent (TreeViewer) computes the
  // list of child names for each node and pushes it down here so
  // the brief-mode tooltip can show "sub-conceptos" without doing
  // its own graph traversal on every hover. The TreeNode reads it
  // and the TreeNodeTooltip renders it.
  childNames?: string[];
  // Inline edit — true for nodes the user just created. The TreeNode
  // renders an editable name + description field instead of the
  // read-only view. The parent tracks the set of "recently added"
  // ids and pushes `isNew: true` only for those. Once the id leaves
  // the set (after a TTL or on first save) the node reverts to the
  // standard read-only view.
  isNew?: boolean;
  // F4.5 — async action in flight. `true` while the user has just
  // clicked a mutation button (Podar, Unir, Dividir, Eliminar,
  // Añadir hijo) and the corresponding server action is awaiting.
  // The TreeViewer owns the set of "currently in flight" ids and
  // pushes `pending: true` down so the TreeNode can render a
  // subtle dim + pulse and the user gets immediate visual
  // feedback that the action is working. The set is cleared in a
  // `finally` block, so a failed action also clears the flag.
  pending?: boolean;
  // Inline edit — fired by the TreeNode when the user saves the
  // inline editor. The parent is expected to call the server action
  // and update its own state with the result.
  onSaveInlineEdit?: (
    values: { name: string; summary: string | null }
  ) => Promise<void>;
}

export type TreeFlowNode = Node<TreeFlowNodeData>;
export type TreeFlowEdge = Edge;

/**
 * Build a list of ReactFlow edges from a flat TopicNode[]. An edge is
 * emitted for every (parentId → id) pair; root nodes (parentId === null)
 * produce no outgoing edge.
 */
export function buildEdges(nodes: TopicNode[]): TreeFlowEdge[] {
  const ids = new Set(nodes.map((n) => n.id));
  const edges: TreeFlowEdge[] = [];
  for (const node of nodes) {
    if (node.parentId && ids.has(node.parentId)) {
      edges.push({
        id: `${node.parentId}->${node.id}`,
        source: node.parentId,
        target: node.id,
        type: "smoothstep",
      });
    }
  }
  return edges;
}

/**
 * Convert a TopicNode[] into a ReactFlow node array. Position is left
 * at (0, 0) — the TreeViewer applies dagre layout on top of this.
 *
 * F4.2 — also pre-computes `childNames` per node (the titles of
 * immediate children in the tree). Doing it here means the per-node
 * TreeNode doesn't need to walk the whole graph on every render.
 */
export function buildNodes(
  nodes: TopicNode[],
  counts?: Map<string, { concepts: number; slides: number }>,
  isNew?: (id: string) => boolean
): TreeFlowNode[] {
  // Index children per parent id once. O(N) up front vs O(N) per
  // node in the map below.
  const childrenByParent = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = childrenByParent.get(node.parentId);
    if (list) {
      list.push(node.name);
    } else {
      childrenByParent.set(node.parentId, [node.name]);
    }
  }

  return nodes.map((node) => {
    const enrichment = counts?.get(node.id);
    const data: TreeFlowNodeData = {
      name: node.name,
      summary: node.summary,
      depth: node.depth,
      isLeaf: node.isLeaf,
      version: node.version,
      sourceMaterialId: node.sourceMaterialId,
      // F4.2 — pre-computed child titles. Empty array for leaves
      // (no children) and for roots that have no kids yet.
      childNames: childrenByParent.get(node.id) ?? [],
    };
    if (enrichment) {
      data.conceptCount = enrichment.concepts;
      data.slideCount = enrichment.slides;
    }
    // Inline edit — only attach `isNew` to nodes the parent has
    // marked as recently created. We compute the flag on the
    // OUTSIDE (so the adapter stays pure) and pass it via the
    // optional `isNew` predicate.
    if (isNew?.(node.id)) {
      data.isNew = true;
    }
    return {
      id: node.id,
      type: "topic",
      position: { x: 0, y: 0 },
      data,
    };
  });
}

export interface UseTreeAdapterOptions {
  /**
   * Optional map of nodeId → { concepts, slides } to enrich the
   * rendered tiles with counts. Computed once and passed in; the
   * adapter never queries the DB itself.
   */
  counts?: Map<string, { concepts: number; slides: number }>;
  /**
   * Optional predicate that returns true for nodes the user just
   * created (within the parent's TTL window). The adapter attaches
   * `isNew: true` to the data of those nodes so the TreeNode can
   * render the inline-edit fields. When omitted, no node is marked
   * as new.
   */
  isNew?: (id: string) => boolean;
  /**
   * Optional callback the TreeNode fires when the user saves the
   * inline editor. The parent is expected to call the server
   * action and refresh the local nodes list. The adapter just
   * forwards the call.
   */
  onSaveInlineEdit?: (
    id: string,
    values: { name: string; summary: string | null }
  ) => Promise<void>;
}

/**
 * The hook used by the TreeViewer. Converts the DB model (a flat
 * TopicNode[] with parentId pointers) into the shape ReactFlow
 * expects, and exposes action callbacks that bridge UI events to
 * the server actions in `lib/actions/tree.ts`.
 *
 * The hook intentionally keeps no derived store state — selection
 * lives in local state because it is purely UI concern, and any
 * "committed" tree mutations go through the server actions which
 * call revalidatePath.
 */
export function useTreeAdapter(
  nodes: TopicNode[],
  options: UseTreeAdapterOptions = {}
) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const reactFlowNodes = useMemo(
    () => buildNodes(nodes, options.counts, options.isNew),
    [nodes, options.counts, options.isNew]
  );
  const reactFlowEdges = useMemo(() => buildEdges(nodes), [nodes]);

  const courseId = nodes[0]?.courseId ?? "";

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const onEdit = useCallback(
    async (id: string, data: UpdateTreeNodeInput) => {
      return updateTreeNodeAction(id, data);
    },
    []
  );

  const onDelete = useCallback(async (id: string) => {
    return deleteTreeNodeAction(id);
  }, []);

  const onMerge = useCallback(
    async (parentId: string, childIds: string[], name: string) => {
      return mergeTreeNodesAction(parentId, childIds, name);
    },
    []
  );

  const onSplit = useCallback(async (id: string) => {
    return splitTreeNodeAction(id);
  }, []);

  const onAddChild = useCallback(
    async (parentId: string, data: AddTreeNodeInput) => {
      return addTreeNodeAction(courseId, parentId, data);
    },
    [courseId]
  );

  const onAddRoot = useCallback(
    async (data: AddTreeNodeInput) => {
      return addTreeNodeAction(courseId, null, data);
    },
    [courseId]
  );

  return {
    reactFlowNodes,
    reactFlowEdges,
    selectedIds,
    toggleSelect,
    clearSelection,
    onEdit,
    onDelete,
    onMerge,
    onSplit,
    onAddChild,
    onAddRoot,
  };
}

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
 */
export function buildNodes(
  nodes: TopicNode[],
  counts?: Map<string, { concepts: number; slides: number }>
): TreeFlowNode[] {
  return nodes.map((node) => {
    const enrichment = counts?.get(node.id);
    const data: TreeFlowNodeData = {
      name: node.name,
      summary: node.summary,
      depth: node.depth,
      isLeaf: node.isLeaf,
      version: node.version,
      sourceMaterialId: node.sourceMaterialId,
    };
    if (enrichment) {
      data.conceptCount = enrichment.concepts;
      data.slideCount = enrichment.slides;
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
    () => buildNodes(nodes, options.counts),
    [nodes, options.counts]
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

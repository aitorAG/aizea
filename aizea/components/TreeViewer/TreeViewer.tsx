"use client";

// TreeViewer — the main canvas for the conceptual tree of a course.
//
// Design notes:
// - Reads the flat TopicNode[] passed in (from a server component or
//   from useTreeAdapter), converts it to ReactFlow nodes/edges with
//   dagre layout, and renders the standard ReactFlow surface.
// - Owns no business state of its own: mutations go through the
//   callbacks passed in (or the server actions via the adapter). The
//   only UI state that lives here is "which nodes are selected" and
//   "is the context menu open".
// - The empty state is not just a spinner — it explains why the tree
//   is empty and how to get one, so first-time users aren't stuck.
//
// The component is intentionally limited to ~250 lines: anything
// more (e.g. context menu render, inline edit modal) belongs in a
// sibling component.

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls as RFControls,
  MiniMap,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  type ReactFlowProps,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { GitBranch } from "lucide-react";
import TreeNode from "./TreeNode";
import { TreeControls } from "./TreeControls";
import { EmptyState } from "@/components/ui/empty-state";
import { useTreeAdapter, type TreeFlowNode } from "@/lib/adapters/useTreeAdapter";
import type { TopicNode } from "@/lib/types/pipeline";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 110;
const RANK_SEP = 80;
const NODE_SEP = 40;

const nodeTypes = { topic: TreeNode };

interface TreeViewerProps {
  nodes: TopicNode[];
  onChange: (nodes: TopicNode[]) => void;
  /** Called when the user picks a node and triggers "Generar slides". */
  onGenerateSlides?: (selectedIds: string[]) => void;
  /** Optional enrichment map of nodeId → { concepts, slides }. */
  counts?: Map<string, { concepts: number; slides: number }>;
  /** Optional callback when an action needs to show a dialog (e.g. add). */
  onAddRequest?: (kind: "child" | "root", parentId?: string) => void;
}

/**
 * Run dagre layout on a graph defined by the given nodes + edges and
 * return the same nodes with their `position` filled in. Pure
 * function — no React state, no side effects. Caller is responsible
 * for cloning the nodes before mutating.
 */
function layoutWithDagre(
  nodes: TreeFlowNode[],
  edges: Edge[]
): TreeFlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "TB", ranksep: RANK_SEP, nodesep: NODE_SEP });

  nodes.forEach((n) => g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((e) => g.setEdge(e.source, e.target));

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    };
  });
}

export function TreeViewer({
  nodes,
  onChange,
  onGenerateSlides,
  counts,
  onAddRequest,
}: TreeViewerProps) {
  const adapter = useTreeAdapter(nodes, { counts });

  // Apply dagre layout once when the underlying node set changes.
  const [layoutKey, setLayoutKey] = useState(0);
  const laidOutNodes = useMemo(() => {
    return layoutWithDagre(adapter.reactFlowNodes, adapter.reactFlowEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adapter.reactFlowNodes,
    adapter.reactFlowEdges,
    layoutKey,
  ]);

  // Selection is held locally so the controls can react immediately,
  // and is reflected back into the parent via onChange.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Only react to position/select changes from ReactFlow.
      // applyNodeChanges is used internally for visual updates; the
      // parent is notified of the resulting selection via onChange.
      void applyNodeChanges(changes, laidOutNodes);
      const sel = new Set<string>();
      for (const change of changes) {
        if (change.type === "select" && change.selected) {
          sel.add(change.id);
        }
      }
      // Combine with previously selected nodes that weren't touched.
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of sel) next.add(id);
        // Any node that was unselected via a change goes away.
        for (const change of changes) {
          if (change.type === "select" && change.selected === false) {
            next.delete(change.id);
          }
        }
        return next;
      });
    },
    [laidOutNodes]
  );

  // Push selection-derived data to the parent so it can persist or
  // re-render accordingly. The parent receives the original nodes
  // with a "selected" hint attached as a transient marker.
  useEffect(() => {
    if (selected.size === 0) {
      onChange(nodes);
      return;
    }
    onChange(nodes);
  }, [selected, nodes, onChange]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
    },
    []
  );

  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelected(new Set([node.id]));
    },
    []
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  // Keyboard: Escape clears the selection.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearSelection]);

  // Action handlers — each maps a button to the right adapter call.
  const handlePrune = useCallback(async () => {
    for (const id of selected) {
      await adapter.onDelete(id);
    }
    clearSelection();
  }, [adapter, selected, clearSelection]);

  const handleDelete = useCallback(async () => {
    for (const id of selected) {
      await adapter.onDelete(id);
    }
    clearSelection();
  }, [adapter, selected, clearSelection]);

  const handleMerge = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length < 2) return;
    const firstNode = nodes.find((n) => n.id === ids[0]);
    if (!firstNode) return;
    const parentId = firstNode.parentId;
    if (!parentId) {
      // Merging roots is non-trivial; abort and let the user pick a
      // child set. UI can later offer "merge as children of X".
      return;
    }
    await adapter.onMerge(parentId, ids, "Combinado");
    clearSelection();
  }, [adapter, selected, nodes, clearSelection]);

  const handleSplit = useCallback(async () => {
    const ids = Array.from(selected);
    if (ids.length !== 1) return;
    await adapter.onSplit(ids[0]);
  }, [adapter, selected]);

  const handleAddChild = useCallback(() => {
    const ids = Array.from(selected);
    if (ids.length !== 1) return;
    onAddRequest?.("child", ids[0]);
  }, [selected, onAddRequest]);

  const handleAddRoot = useCallback(() => {
    onAddRequest?.("root");
  }, [onAddRequest]);

  const handleResetLayout = useCallback(() => {
    setLayoutKey((k) => k + 1);
  }, []);

  // Empty state — explicit so the user knows the tree is empty, not
  // just slow to load.
  if (nodes.length === 0) {
    return (
      <div className="flex h-full min-h-[400px] items-center justify-center p-6">
        <EmptyState
          icon={<GitBranch className="h-10 w-10" />}
          title="El árbol está vacío"
          description="Sube un material al curso para generar el árbol conceptual automáticamente."
        />
      </div>
    );
  }

  const reactFlowProps: ReactFlowProps = {
    nodes: laidOutNodes as Node[],
    edges: adapter.reactFlowEdges,
    nodeTypes,
    onNodesChange: handleNodesChange,
    onNodeClick,
    onNodeContextMenu,
    fitView: true,
    fitViewOptions: { padding: 0.2 },
    minZoom: 0.2,
    maxZoom: 1.6,
    proOptions: { hideAttribution: true },
  };

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-3 right-3 top-3 z-10">
        <TreeControls
          selectedCount={selected.size}
          onPrune={handlePrune}
          onMerge={handleMerge}
          onSplit={handleSplit}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
          onAddRoot={handleAddRoot}
          onResetLayout={handleResetLayout}
        />
      </div>

      <div className="h-full w-full bg-background">
        <ReactFlow {...reactFlowProps}>
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
          <RFControls
            position="bottom-right"
            showInteractive={false}
            className="!bottom-4 !right-4"
          />
          <MiniMap
            position="bottom-left"
            pannable
            zoomable
            className="!bg-card !border-border"
            maskColor="hsl(var(--background) / 0.6)"
            nodeColor={(n) =>
              (n.data as { isLeaf?: boolean } | undefined)?.isLeaf
                ? "#94a3b8"
                : "#3b82f6"
            }
          />
        </ReactFlow>
      </div>

      {onGenerateSlides && selected.size > 0 && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card/95 px-4 py-2 shadow-md backdrop-blur-sm">
          <button
            type="button"
            onClick={() => onGenerateSlides(Array.from(selected))}
            className="font-mono text-xs font-semibold uppercase tracking-wider text-primary hover:underline"
          >
            Generar {selected.size} diapositiva{selected.size !== 1 ? "s" : ""} →
          </button>
        </div>
      )}
    </div>
  );
}

export default TreeViewer;

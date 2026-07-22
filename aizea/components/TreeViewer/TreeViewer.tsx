"use client";

// TreeViewer — the main canvas for the conceptual tree of a course.
//
// Design notes:
// - Reads the flat TopicNode[] passed in (from a server component or
//   from useTreeAdapter), converts it to ReactFlow nodes/edges with
//   dagre layout, and renders the standard ReactFlow surface.
// - Owns the multi-checkbox selection state (F4.1) as a Set<string>.
//   The selection state is pushed down to every node via
//   `data.selected` and `data.onSelectToggle`, so the TreeNode can
//   render a dedicated checkbox without prop-drilling and without
//   relying on ReactFlow's built-in `selected` prop (which used to
//   cause the confusing "body click toggles" behavior — see RCA in
//   the F4.1 plan).
// - The body click on a node is INTENTIONALLY a no-op for selection
//   (it can be wired to "open detail / zoom" in a future wave).
//   This is the design change that makes the previous class of
//   bugs (selecting a 2nd node unselecting the 1st, tick visible
//   without intent, etc.) impossible.
// - The only other UI state that lives here is "is the context menu
//   open". Mutations go through the callbacks passed in (or the
//   server actions via the adapter).
//
// v1.5 / Task 3.1 — single-node edit modal. The toolbar exposes an
//   "Editar" button that, when exactly one node is selected, opens
//   a Dialog with the existing `InlineTreeNodeEditor` pre-filled
//   with that node's name + summary. The modal lives here (not in
//   TreeControls) because it needs the selected node's data, which
//   the toolbar doesn't receive. The save handler calls
//   `onSaveInlineEdit` — the same callback used by the inline form
//   that appears on freshly-created nodes — so the persist + state
//   update path is shared.
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
import { InlineTreeNodeEditor } from "./InlineTreeNodeEditor";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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
  /**
   * F4.3 — called when the user clicks the "Generar todas las
   * diapositivas" toolbar button. The parent is responsible for
   * generating slides for EVERY node in the tree, ignoring the
   * current checkbox selection. When omitted, the toolbar button is
   * not rendered.
   */
  onGenerateAllSlides?: () => void;
  /** Optional enrichment map of nodeId → { concepts, slides }. */
  counts?: Map<string, { concepts: number; slides: number }>;
  /**
   * Wired by the parent when the user clicks "Añadir raíz" or
   * "Añadir hijo" in the toolbar. The parent is expected to call
   * the corresponding server action (`addTreeNodeAction`) with a
   * placeholder name + summary, then update its node set with the
   * returned node. While the placeholder is being created the
   * button should be disabled (handled by the parent via `busy`).
   */
  onAddRequest?: (kind: "child" | "root", parentId?: string) => void;
  /**
   * Predicate the adapter uses to mark recently-created nodes so
   * the TreeNode can show the inline-edit fields. The parent owns
   * the underlying Set<string> (with a TTL) and supplies the
   * predicate. When omitted, no node is marked as new.
   */
  isNewNode?: (id: string) => boolean;
  /**
   * Fired by the TreeNode when the user saves the inline editor
   * (Enter / blur on the description field). The parent is
   * expected to call the server action `updateTreeNodeAction` and
   * update the local nodes list with the result.
   */
  onSaveInlineEdit?: (
    id: string,
    values: { name: string; summary: string | null }
  ) => Promise<void>;
  /**
   * F6.B — fired after a mutation action (Prune / Delete / Merge /
   * Split) so the parent can keep its local `nodes` state in sync
   * with the server-side change. Without this, the tree visually
   * shows the deleted/merged/split node until the user reloads,
   * because the TreeViewer owns the pending UI state but the
   * actual node list lives in the parent.
   *
   *  - `deletedIds`: nodes that were removed (Prune / Delete /
   *    Merge). The parent should `filter` them out.
   *  - `addedNode`: a single new node to insert (Merge creates a
   *    new merged child). The parent should append it.
   *  - `updatedNode`: a single node whose server-side state was
   *    updated (Split marks the original as non-leaf). The parent
   *    should `map` it in place.
   *
   * AddChild / AddRoot already flow through `onAddRequest`, which
   * the parent uses to refresh the local list — no need to fire
   * the callback from those paths.
   */
  onNodesChanged?: (
    deletedIds?: string[],
    addedNode?: TopicNode,
    updatedNode?: TopicNode
  ) => void;
  /**
   * v1.5 / Task 3.2 — fullscreen mode flag. When `true`, the parent
   * (tree-client.tsx) has hidden the page header and the
   * CheckpointBar; the toolbar button that toggles this state
   * shows the inverse icon (Minimize2). The flag is owned by the
   * parent because the page-level header lives there — we just
   * mirror it so the toolbar can pick the right icon.
   */
  isFullscreen?: boolean;
  /**
   * v1.9 / Issue 3 — disable the toolbar's "Generar diapositivas"
   * button while the in-flight server action is running. Without
   * this the user could double-click and trigger a second
   * `createMinimalSlides` call (which would create duplicate
   * slides). The parent owns the flag (`generatingSlidesOnly` in
   * tree-client.tsx) because the actual action lives there; we
   * just forward it down to the toolbar.
   */
  busy?: boolean;
  /** v1.5 / Task 3.2 — toggles the parent's fullscreen state. */
  onToggleFullscreen?: () => void;
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
  onGenerateAllSlides,
  counts,
  onAddRequest,
  isNewNode,
  onSaveInlineEdit,
  onNodesChanged,
  isFullscreen = false,
  onToggleFullscreen,
  // v1.9 / Issue 3 — see the prop doc above. Defaults to `false`
  // so older callers (e.g. tests) keep working unchanged.
  busy = false,
}: TreeViewerProps) {
  const adapter = useTreeAdapter(nodes, {
    counts,
    isNew: isNewNode,
    onSaveInlineEdit,
  });

  // F4.1 — multi-checkbox selection. The Set is the single source of
  // truth for "which nodes are selected". The TreeNode reads its
  // checked state from `data.selected` (pushed down in the memo
  // below) and calls `data.onSelectToggle` when its checkbox is
  // clicked. Body click on a node is intentionally a no-op for
  // selection — see RCA in the F4.1 plan.
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    () => new Set()
  );

  // F4.5 — async action in flight. While a mutation handler
  // (Podar, Unir, Dividir, Eliminar, Añadir hijo) is awaiting its
  // server action the affected node ids are added to this set so
  // the TreeNode can render a subtle dim + pulse. The set is
  // cleared in a `finally` block, so a thrown / rejected action
  // also clears the flag — there is no path that leaves a node
  // stuck in "pending" forever. The set is keyed by node id so
  // multi-action handlers (Podar/Eliminar over N nodes, Unir
  // over N nodes) can track every affected tile independently.
  const [pendingNodeIds, setPendingNodeIds] = useState<Set<string>>(
    () => new Set()
  );

  /** Add the given ids to the pending set. Pure helper used by
   *  every mutation handler so they all use the same
   *  immutable-Set update pattern. */
  const addPending = useCallback((ids: Iterable<string>) => {
    setPendingNodeIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  /** Remove the given ids from the pending set. Called from
   *  `finally` so it runs on both success and error. */
  const removePending = useCallback((ids: Iterable<string>) => {
    setPendingNodeIds((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of ids) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  // v1.5 / Task 3.1 — single-node edit modal. The id of the node
  // currently being edited in the modal, or `null` when the modal
  // is closed. The toolbar's "Editar" button sets this to the
  // single selected id; Escape / the close button / a successful
  // save clear it. Keeping it in component state (instead of
  // deriving from `selectedNodeIds`) means the modal stays open
  // even if the user un-checks the box while editing, which would
  // otherwise yank the form out from under them.
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const editingNode = useMemo(
    () => (editingNodeId ? nodes.find((n) => n.id === editingNodeId) ?? null : null),
    [editingNodeId, nodes]
  );
  const handleEdit = useCallback(() => {
    if (selectedNodeIds.size !== 1) return;
    const [id] = selectedNodeIds;
    setEditingNodeId(id);
  }, [selectedNodeIds]);
  const handleCloseEdit = useCallback(() => {
    setEditingNodeId(null);
  }, []);

  /** Toggle a single node in the selection set. */
  const toggleNodeSelection = useCallback((nodeId: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }, []);

  /** Empty the selection set. */
  const clearSelection = useCallback(() => {
    setSelectedNodeIds(new Set());
  }, []);

  /** Fill the selection set with the provided node ids. */
  const selectAll = useCallback((nodeIds: string[]) => {
    setSelectedNodeIds(new Set(nodeIds));
  }, []);

  // Dagre layout + selection propagation in a single memo. Overriding
  // `selected` here means ReactFlow's own selection model can't fight
  // with our Set — the renderer reads from a single source of truth.
  //
  // F4.5 — also pushes `data.pending` (per-node) so the TreeNode
  // can render a dim + pulse for any id currently in
  // `pendingNodeIds`. The selection-vs-pending axes are independent
  // (a node can be selected AND pending at the same time, e.g. a
  // single-node Eliminar that the user has just confirmed).
  const laidOutNodes = useMemo(() => {
    const base = layoutWithDagre(adapter.reactFlowNodes, adapter.reactFlowEdges);
    return base.map((n) => ({
      ...n,
      selected: selectedNodeIds.has(n.id),
      data: {
        ...n.data,
        selected: selectedNodeIds.has(n.id),
        pending: pendingNodeIds.has(n.id),
        onSelectToggle: () => toggleNodeSelection(n.id),
      },
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adapter.reactFlowNodes,
    adapter.reactFlowEdges,
    selectedNodeIds,
    pendingNodeIds,
    toggleNodeSelection,
  ]);

  // ReactFlow's onNodesChange can produce position/dimension/remove
  // events that we want to apply, AND "select" events that we
  // explicitly want to IGNORE. F4.1 — selection is driven
  // exclusively by the checkbox; body clicks must not move the
  // selection set. Without this filter, a body click on an
  // unselected node would emit a ReactFlow "select" change that
  // (by default) replaces the entire selection with just the
  // clicked node, breaking multi-select in the real browser even
  // though the unit test passes (the test mock doesn't replicate
  // this ReactFlow behaviour).
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const nonSelectChanges = changes.filter((c) => c.type !== "select");
      void applyNodeChanges(nonSelectChanges, laidOutNodes);
    },
    [laidOutNodes]
  );

  // Push tree changes back to the parent so it can persist or
  // re-render accordingly. The selection set itself is UI state
  // and does not leak to the parent.
  useEffect(() => {
    onChange(nodes);
  }, [nodes, onChange]);

  // F4.1 — body click does NOT toggle selection. The previous model
  // toggled selection on every body click, which conflated
  // "open detail" with "select for actions" and was the root cause
  // of the multi-select bug (see RCA in the F4.1 plan). The
  // dedicated checkbox is now the only control that toggles
  // selection; the body click is reserved for future
  // detail/zoom interactions.
  const onNodeClick: NodeMouseHandler = useCallback(() => {
    // Intentionally empty.
  }, []);

  const onNodeContextMenu: NodeMouseHandler = useCallback(
    (_event, node) => {
      // Right-click keeps the legacy behaviour: replace the selection
      // with just this node. This is a non-multi-select shortcut and
      // doesn't go through the checkbox.
      setSelectedNodeIds(new Set([node.id]));
    },
    []
  );

  // Keyboard: Escape clears the selection.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearSelection();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearSelection]);

  // Action handlers — each maps a button to the right adapter call.
  // All of them operate on the full selection set, so multi-select
  // works for every action (merge, delete, generate slides, etc.).
  //
  // F4.5 — every async handler mirrors its lifecycle into the
  // `pendingNodeIds` set: the affected ids are added BEFORE the
  // first `await` and removed in a `finally` so a failed /
  // rejected server action also clears the flag (no node can
  // get stuck in "pending" forever). This is the structural fix
  // for "the tree doesn't appear to update on Podar / Unir /
  // Eliminar" — the in-flight state is now a first-class UI
  // concept, not a hidden implementation detail.
  const handlePrune = useCallback(async () => {
    const ids = Array.from(selectedNodeIds);
    if (ids.length === 0) return;
    addPending(ids);
    try {
      for (const id of ids) {
        await adapter.onDelete(id);
      }
    } finally {
      removePending(ids);
    }
    // F6.B — keep the parent's local node list in sync. Without this
    // the tree visually shows the just-deleted node until reload.
    onNodesChanged?.(ids);
    clearSelection();
  }, [adapter, selectedNodeIds, addPending, removePending, clearSelection, onNodesChanged]);

  const handleDelete = useCallback(async () => {
    const ids = Array.from(selectedNodeIds);
    if (ids.length === 0) return;
    addPending(ids);
    try {
      for (const id of ids) {
        await adapter.onDelete(id);
      }
    } finally {
      removePending(ids);
    }
    // F6.B — keep the parent's local node list in sync. Without this
    // the tree visually shows the just-deleted node until reload.
    onNodesChanged?.(ids);
    clearSelection();
  }, [adapter, selectedNodeIds, addPending, removePending, clearSelection, onNodesChanged]);

  const handleMerge = useCallback(async () => {
    const ids = Array.from(selectedNodeIds);
    if (ids.length < 2) return;
    const firstNode = nodes.find((n) => n.id === ids[0]);
    if (!firstNode) return;
    const parentId = firstNode.parentId;
    if (!parentId) {
      // Merging roots is non-trivial; abort and let the user pick a
      // child set. UI can later offer "merge as children of X".
      return;
    }
    // Mark every merged child as pending — all of them disappear
    // from the tree once the merge completes.
    addPending(ids);
    try {
      const result = await adapter.onMerge(parentId, ids, "Combinado");
      // F6.B — remove the merged siblings and insert the new merged
      // node into the parent's local list in a single update.
      if (result.ok) onNodesChanged?.(ids, result.node);
    } finally {
      removePending(ids);
    }
    clearSelection();
  }, [adapter, selectedNodeIds, nodes, addPending, removePending, clearSelection, onNodesChanged]);

  const handleSplit = useCallback(async () => {
    const ids = Array.from(selectedNodeIds);
    if (ids.length !== 1) return;
    const id = ids[0];
    addPending([id]);
    try {
      const result = await adapter.onSplit(id);
      // F6.B — the original node is no longer a leaf after the
      // split; surface the first new child as the "addedNode" so
      // the parent at least sees one of the two new tiles appear.
      if (result.ok && result.nodes.length > 0) {
        onNodesChanged?.(undefined, result.nodes[0], undefined);
      }
    } finally {
      removePending([id]);
    }
  }, [adapter, selectedNodeIds, addPending, removePending, onNodesChanged]);

  const handleAddChild = useCallback(async () => {
    const ids = Array.from(selectedNodeIds);
    if (ids.length !== 1) return;
    const parentId = ids[0];
    // F4.5 — the parent tile gets a brief "pending" pulse while
    // the new child is being created server-side. The new child
    // itself doesn't exist yet so we can't mark IT as pending —
    // it appears with the "isNew" flag the moment the server
    // action returns (handled by the page's `recentlyAdded` set).
    addPending([parentId]);
    try {
      await onAddRequest?.("child", parentId);
    } finally {
      removePending([parentId]);
    }
  }, [selectedNodeIds, onAddRequest, addPending, removePending]);

  const handleAddRoot = useCallback(() => {
    onAddRequest?.("root");
  }, [onAddRequest]);

  // v1.5 / Task 3.1 — persist the edit-modal save. Delegates to
  // the same `onSaveInlineEdit` callback used by the inline form
  // on freshly-created nodes (see tree-client.tsx — it calls
  // `updateTreeNodeAction` and patches the local node in place).
  // We don't clear `editingNodeId` here on purpose: the parent's
  // `onSaveInlineEdit` is `async` and may reject; the editor
  // surfaces the error itself and stays open so the user can fix
  // it. The close path is `handleCloseEdit` (Escape / close
  // button), which the user triggers manually once the "Guardado"
  // flash confirms the change.
  const handleSaveEdit = useCallback(
    async (values: { name: string; summary: string | null }) => {
      if (!editingNodeId || !onSaveInlineEdit) return;
      await onSaveInlineEdit(editingNodeId, values);
    },
    [editingNodeId, onSaveInlineEdit]
  );

  // F4.1 — "Seleccionar todas". Fills the selection set with every
  // visible node. Triggered from the toolbar; the actual button
  // lives in TreeControls.
  const handleSelectAll = useCallback(() => {
    selectAll(nodes.map((n) => n.id));
  }, [selectAll, nodes]);

  // F4.1 — TOGGLE behaviour for the toolbar button. If every node
  // is already selected the next click empties the selection set
  // (so the user can deselect the whole tree in a single click);
  // otherwise the next click fills the selection set with every
  // node id. The button label/variant in TreeControls reflects
  // which action the next click will perform.
  const handleToggleSelectAll = useCallback(() => {
    setSelectedNodeIds((prev) => {
      // "all selected" requires at least one node — otherwise the
      // toggle is undefined and we fall back to "select all".
      const isAllSelected =
        nodes.length > 0 && prev.size === nodes.length;
      if (isAllSelected) return new Set();
      return new Set(nodes.map((n) => n.id));
    });
  }, [nodes]);

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
          selectedCount={selectedNodeIds.size}
          totalNodeCount={nodes.length}
          onPrune={handlePrune}
          onMerge={handleMerge}
          onSplit={handleSplit}
          onDelete={handleDelete}
          onAddChild={handleAddChild}
          onAddRoot={handleAddRoot}
          onEdit={handleEdit}
          onSelectAll={handleSelectAll}
          onToggleSelectAll={handleToggleSelectAll}
          onClearSelection={clearSelection}
          onGenerateAllSlides={onGenerateAllSlides}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          // v1.9 / Issue 3 — propagate the in-flight flag down
          // to the toolbar so the "Generar diapositivas" button
          // can disable itself while the server action runs.
          busy={busy}
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

      {onGenerateSlides && selectedNodeIds.size > 0 && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card/95 px-4 py-2 shadow-md backdrop-blur-sm">
          <button
            type="button"
            onClick={() => onGenerateSlides(Array.from(selectedNodeIds))}
            className="font-mono text-xs font-semibold uppercase tracking-wider text-primary hover:underline"
          >
            Generar {selectedNodeIds.size} diapositiva{selectedNodeIds.size !== 1 ? "s" : ""} →
          </button>
        </div>
      )}

      {/* v1.5 / Task 3.1 — single-node edit modal. Reuses the
          InlineTreeNodeEditor so the save flow / state machine
          / error UX are shared with the freshly-created-node
          path. The modal closes via Escape, the X button, or a
          successful save (the parent re-renders us with the
          updated node and the user dismisses it themselves; we
          deliberately do NOT auto-close on save because the
          "Guardado" flash + Escape is more discoverable). The
          title shows the current name so the user can confirm
          they're editing the right box. */}
      <Dialog open={editingNode !== null} onClose={handleCloseEdit}>
        <DialogHeader>
          <DialogTitle>Editar nodo</DialogTitle>
          <DialogDescription>
            Cambia el nombre y la descripción del nodo. Enter o
            Tab guardan los cambios.
          </DialogDescription>
        </DialogHeader>
        {editingNode && (
          <div className="mt-4" data-testid="edit-node-modal">
            <p
              className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
              data-testid="edit-node-current-name"
            >
              Editando: {editingNode.name}
            </p>
            <InlineTreeNodeEditor
              key={editingNode.id}
              initialName={editingNode.name}
              initialSummary={editingNode.summary}
              onSave={handleSaveEdit}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}

export default TreeViewer;

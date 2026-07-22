"use client";

// TreeNode — the custom ReactFlow node renderer for a TopicNode.
//
// Design notes:
//
// F4.1 — multi-checkbox selection:
//   - Each tile shows the node name (truncated), a one-line summary, and
//     small monospace counters for concepts and slides so the user can
//     scan the tree quickly.
//   - Branch nodes (isLeaf=false) get a distinct visual treatment (left
//     accent bar) and a small "branch" badge. Leaves are quieter.
//   - Selection is driven by a DEDICATED checkbox in the top-right
//     corner. The checkbox is the only thing that toggles selection —
//     clicking the body of the tile is reserved for "open detail /
//     zoom" in the future, and must NOT change the selection. This
//     decouples two different user intents that the previous model
//     was conflating (see RCA in the F4.1 plan).
//   - The checkbox is intentionally small and subtle (estilo email): a
//     low-emphasis square that becomes more prominent on hover or when
//     checked. The selected tile also gets a ring + accent so the
//     selection state is visible at a glance even when the user is
//     looking at the body of the tile.
//   - The selection state is read from `data.selected` (owned by the
//     parent TreeViewer) — NOT from ReactFlow's `selected` prop. The
//     parent overrides `selected` and attaches `onSelectToggle` to the
//     node data so the checkbox can fire it without prop-drilling.
//
// F4.2 — hover tooltip with progressive disclosure:
//   - State machine: `idle → brief` on `onMouseEnter`, then `brief →
//     full` after 3s of continuous hover, and back to `idle` on
//     `onMouseLeave`. The timer is held in a `useRef` so the state
//     set when the timer fires doesn't itself cause a re-render
//     loop. The timer is cleared on every leave AND on unmount.
//   - The tooltip (TreeNodeTooltip) is rendered INSIDE the tile but
//     uses `pointer-events: none` — see the test for the regression
//     guard. This is the design change that makes "tooltip blocks
//     checkbox" impossible: it can't, because it doesn't receive
//     pointer events at all.
//   - Position is computed from the node's bounding rect at enter
//     time. We don't try to follow the node if the user pans/zooms
//     (that's a future wave) — the tooltip is a quick preview, not a
//     persistent panel.
//   - The hover area is the tile body, NOT the checkbox. `onMouseEnter`
//     doesn't fire when the mouse moves between siblings, so hovering
//     the checkbox does NOT open the tooltip and the tooltip closing
//     when the user clicks the checkbox is impossible.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { GitBranch, Leaf, Check, PencilLine } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeFlowNodeData } from "@/lib/adapters/useTreeAdapter";
import {
  TreeNodeTooltip,
  type TooltipPosition,
} from "./TreeNodeTooltip";
import { InlineTreeNodeEditor } from "./InlineTreeNodeEditor";

/** Number of ms of continuous hover before the tooltip transitions
 *  from 'brief' (sub-conceptos) to 'full' (corpus). Locked by the
 *  F4.2 plan ("≥ 3 segundos en la misma caja") and by the test
 *  suite — change both together. */
const HOVER_FULL_DELAY_MS = 3000;

/** F4.2 — the three states the hover machine can be in. The
 *  component renders the tooltip iff state !== 'idle'. */
type HoverState = "idle" | "brief" | "full";

function TreeNode({ data }: NodeProps<TreeFlowNodeData>) {
  const isLeaf = data.isLeaf;
  const isSelected = data.selected ?? false;
  const conceptCount = data.conceptCount ?? 0;
  const slideCount = data.slideCount ?? 0;
  // Inline-edit mode is driven by `data.isNew`, which the parent
  // (TreeViewer / useTreeAdapter) sets only for nodes the user has
  // just created. While `isNew` is true the static name + summary
  // read-only view is REPLACED by the InlineTreeNodeEditor so the
  // user can immediately define the box's intent. The parent
  // removes the id from its "recently added" set after a save
  // (or after a TTL) and the editor reverts to the read-only view.
  const isNew = data.isNew === true;
  // F4.5 — async action in flight. `true` while the user has just
  // clicked a mutation button and the server action is awaiting.
  // We render a subtle dim (opacity-60) + a pulse so the user gets
  // immediate visual feedback that the action is working — this
  // is the structural fix for "the tree doesn't appear to update
  // on Podar / Unir / Eliminar / Añadir hijo". The checkbox
  // stays clickable so the user can still change the selection
  // during the in-flight window.
  const isPending = data.pending === true;

  // F4.2 — hover state machine. The state lives here (in the node)
  // and NOT in the parent TreeViewer because:
  //   - The state is per-tile, not per-tree; lifting it would force
  //     the parent to track a Map<nodeId, HoverState> for no benefit.
  //   - Each tile owns its own timer ref, so there's no shared
  //     mutable state to coordinate.
  //   - When the user moves between two nodes, each tile's local
  //     machine handles its own enter/leave cleanly — there's no
  //     "stale timer from a previous node" bug class to worry about.
  const [hoverState, setHoverState] = useState<HoverState>("idle");
  const [tooltipPosition, setTooltipPosition] =
    useState<TooltipPosition>("top");

  /** The pending "brief → full" timer. A ref because we never want
   *  to render in response to the timer being set/cleared — only in
   *  response to the state change it eventually causes. */
  const fullTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Clear the pending timer, if any. Safe to call when no timer is
   *  scheduled. */
  const clearFullTimer = useCallback(() => {
    if (fullTimerRef.current !== null) {
      clearTimeout(fullTimerRef.current);
      fullTimerRef.current = null;
    }
  }, []);

  /**
   * Compute the best tooltip position from the node's bounding rect.
   * The decision is made ONCE on enter — the tooltip doesn't follow
   * the node if the user pans/zooms. The heuristic prefers the side
   * with the most room (right → left → top → bottom).
   *
   * Why "right" first?
   *   - The tree is laid out top-to-bottom (dagre TB). Siblings are
   *     stacked vertically, so there's almost always horizontal
   *     room to the right of any given node.
   *   - "Top" runs out of room for the upper rows of the tree
   *     (they're already near the top of the canvas).
   */
  const computePosition = useCallback(
    (rect: DOMRect): TooltipPosition => {
      if (typeof window === "undefined") return "top";
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const TOOLTIP_W = 280;
      const TOOLTIP_H = 200; // estimate; close enough for the heuristic
      const GAP = 8;

      // Right: needs at least TOOLTIP_W + GAP to the right.
      if (rect.right + TOOLTIP_W + GAP <= vw) return "right";
      // Left: needs at least TOOLTIP_W + GAP to the left.
      if (rect.left - (TOOLTIP_W + GAP) >= 0) return "left";
      // Top: needs at least TOOLTIP_H + GAP above.
      if (rect.top - (TOOLTIP_H + GAP) >= 0) return "top";
      // Bottom: last resort.
      return "bottom";
    },
    []
  );

  const handleMouseEnter = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Compute position from the current bounding rect. We capture
      // the rect NOW so the tooltip is stable for the entire hover
      // session, even if the user pans the canvas mid-hover.
      const rect = e.currentTarget.getBoundingClientRect();
      setTooltipPosition(computePosition(rect));
      setHoverState("brief");
      // Schedule the transition to 'full'. We always clear the
      // previous timer first (defensive — a re-entrant enter is
      // possible if React reuses the same node for two parents).
      clearFullTimer();
      fullTimerRef.current = setTimeout(() => {
        setHoverState("full");
        fullTimerRef.current = null;
      }, HOVER_FULL_DELAY_MS);
    },
    [clearFullTimer, computePosition]
  );

  const handleMouseLeave = useCallback(() => {
    clearFullTimer();
    setHoverState("idle");
  }, [clearFullTimer]);

  // Unmount cleanup — if ReactFlow re-renders the canvas (e.g. on a
  // layout reset) while a node is mid-hover, we must not leave a
  // dangling timer that tries to setState on an unmounted component.
  useEffect(() => {
    return () => {
      clearFullTimer();
    };
  }, [clearFullTimer]);

  // The checkbox click handler. We stop propagation so ReactFlow
  // doesn't see it as a body click and so the parent `onNodeClick`
  // (which is intentionally a no-op for selection) doesn't fire.
  const handleToggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    data.onSelectToggle?.();
  };

  // Inline-edit save handler. The editor calls this with the new
  // name + summary. We forward to the parent's `onSaveInlineEdit`
  // (wired through the adapter) which calls the server action and
  // updates the local nodes list. When that update lands the
  // parent re-renders us — and once it removes this id from the
  // "recently added" set, `data.isNew` flips to false and the
  // editor unmounts in favour of the read-only view.
  const handleInlineSave = useCallback(
    async (values: { name: string; summary: string | null }) => {
      if (data.onSaveInlineEdit) {
        await data.onSaveInlineEdit(values);
      }
    },
    [data]
  );

  return (
    <div
      data-testid="tree-node"
      data-selected={isSelected ? "true" : "false"}
      data-is-leaf={isLeaf ? "true" : "false"}
      data-is-new={isNew ? "true" : "false"}
      // F4.5 — expose the pending flag as a DOM attribute so
      // integration tests can assert on the in-flight state
      // without depending on the Tailwind class names.
      data-pending={isPending ? "true" : "false"}
      data-hover={hoverState}
      // F4.2 — hover handlers. `onMouseEnter` is the right event
      // here because it does NOT bubble from children (so hovering
      // the checkbox doesn't re-trigger the brief mode) and it
      // fires only on the transition from outside → inside.
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "group relative w-[220px] rounded-lg border bg-card text-card-foreground shadow-sm transition-all",
        isSelected
          ? "border-primary ring-2 ring-primary/40 ring-offset-1 ring-offset-background"
          : isNew
            ? "border-primary/70 ring-1 ring-primary/30"
            : "border-border hover:border-primary/40",
        isLeaf ? "pl-3" : "pl-3",
        // F4.5 — pending visual. We apply BOTH a constant dim
        // (opacity-60) and a subtle pulse (animate-pulse) so the
        // user gets an unambiguous "this is in flight" cue. The
        // pulse keyframes animate the element's own opacity
        // (0.5 ↔ 1) so they take precedence over the
        // `opacity-60` class; the constant dim is a multiplier
        // applied to the children via the inherited compositing,
        // which keeps the tile visibly dimmer than its idle /
        // selected peers even at the pulse peak.
        isPending && "animate-pulse opacity-60"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-border"
      />

      {/* Left accent bar — visible on branch nodes only */}
      {!isLeaf && (
        <span
          aria-hidden
          className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-primary/80"
        />
      )}

      {/* Multi-select checkbox — the ONLY control that toggles selection.
          Small, in the top-right corner, estilo email: subtle by default,
          becomes fully visible on tile hover or when checked. Stops
          propagation so body click doesn't fire it. */}
      <button
        type="button"
        role="checkbox"
        aria-checked={isSelected}
        aria-label={
          isSelected ? `Deseleccionar ${data.name}` : `Seleccionar ${data.name}`
        }
        data-testid="tree-node-checkbox"
        onClick={handleToggle}
        onMouseDown={(e) => e.stopPropagation()}
        className={cn(
          "absolute right-2 top-2 z-10 flex h-4 w-4 items-center justify-center rounded-[3px] border transition-all",
          // Subtle by default (low opacity). On the parent's :hover we
          // become more visible. Always fully visible when checked.
          isSelected
            ? "border-primary bg-primary text-primary-foreground opacity-100"
            : "border-muted-foreground/40 bg-background/60 text-transparent opacity-60 group-hover:opacity-100 hover:border-primary/70"
        )}
      >
        <Check
          className="h-2.5 w-2.5"
          strokeWidth={4}
          aria-hidden
        />
      </button>

      <div className="p-3">
        <div className="mb-1 flex items-start justify-between gap-2 pr-6">
          {isNew ? (
            // Inline-edit mode — replace the static name + summary
            // with the editable form. The editor takes care of its
            // own state machine and on save fires
            // `onSaveInlineEdit` which the parent handles.
            <div className="min-w-0 flex-1">
              <InlineTreeNodeEditor
                initialName={data.name}
                initialSummary={data.summary}
                onSave={handleInlineSave}
              />
            </div>
          ) : (
            <>
              <p
                data-testid="tree-node-name"
                className="line-clamp-2 text-sm font-medium leading-tight text-foreground"
              >
                {data.name}
              </p>
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                  isLeaf
                    ? "bg-muted text-muted-foreground"
                    : "bg-primary/10 text-primary"
                )}
                title={isLeaf ? "Hoja" : "Rama"}
              >
                {isLeaf ? (
                  <Leaf className="h-3 w-3" />
                ) : (
                  <GitBranch className="h-3 w-3" />
                )}
              </span>
            </>
          )}
        </div>

        {!isNew && data.summary && (
          <p
            data-testid="tree-node-summary"
            className="mb-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground"
          >
            {data.summary}
          </p>
        )}

        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
          {isNew && (
            <span
              data-testid="tree-node-new-badge"
              className="flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-primary"
              title="Nodo recién creado — completa su nombre y descripción"
            >
              <PencilLine className="h-2.5 w-2.5" />
              Nuevo
            </span>
          )}
          {conceptCount > 0 && (
            <span
              data-testid="tree-node-concepts"
              className="rounded bg-muted/70 px-1.5 py-0.5"
              title="Conceptos extraídos"
            >
              {conceptCount} conc.
            </span>
          )}
          {slideCount > 0 && (
            <span
              data-testid="tree-node-slides"
              className="rounded bg-muted/70 px-1.5 py-0.5"
              title="Diapositivas generadas"
            >
              {slideCount} slides
            </span>
          )}
          <span className="ml-auto font-mono text-[9px] uppercase tracking-wider opacity-60">
            d{data.depth}
          </span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-border"
      />

      {/* F4.2 — hover tooltip. Mounted only while hovering. The
          tooltip's own CSS sets `pointer-events: none` so it never
          intercepts clicks on the underlying checkbox or body. */}
      {hoverState !== "idle" && (
        <TreeNodeTooltip
          data={data}
          mode={hoverState === "full" ? "full" : "brief"}
          position={tooltipPosition}
        />
      )}
    </div>
  );
}

// Named export for unit tests (the default export is wrapped in
// `memo` for ReactFlow; the test suite wants to drive the inner
// state machine directly without memo interference).
export { TreeNode };

export default memo(TreeNode);

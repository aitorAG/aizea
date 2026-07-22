"use client";

// TreeNodeTooltip — the floating panel that previews a TopicNode on
// hover (F4.2).
//
// Design contract (locked by tests/unit/tree-node-tooltip.test.tsx
// and tests/unit/tree-node-hover.test.tsx):
//
// 1. Two modes: 'brief' (children titles, max 5) and 'full' (the
//    node's corpus = its summary field). The parent (TreeNode) owns
//    the state machine; this component is purely presentational.
//
// 2. The tooltip MUST NOT intercept clicks. The whole point of F4.1
//    was to decouple "select" from "open detail" via a dedicated
//    checkbox; the hover tooltip must not undo that. The contract is
//    `pointer-events: none` (a single CSS rule, no JS check, no
//    re-rendering) — see the test for the regression guard.
//
// 3. The component is intentionally a thin panel (max ~280px wide,
//    short body) so it stays out of the way of the underlying tile.
//    The full-mode body is capped at ~400 chars; if the summary is
//    longer we show a "leer más" affordance so the user knows there
//    is more content. We don't actually expand it (that's a future
//    wave — the user can click the body to open the detail panel).
//
// 4. Position is a hint from the parent (top/right/bottom/left) —
//    the parent computes it from the node's bounding rect and the
//    viewport. We honour the hint via a `data-position` attribute
//    (useful for tests + future CSS tweaks) but we ALSO apply a
//    default placement (above the node, with a small gap) so the
//    component is usable on its own.

import { cn } from "@/lib/utils";
import type { TreeFlowNodeData } from "@/lib/adapters/useTreeAdapter";

export type TooltipMode = "brief" | "full";
export type TooltipPosition = "top" | "right" | "bottom" | "left";

export interface TreeNodeTooltipProps {
  /** The data attached to the node. We accept the full data object so
   *  the parent doesn't have to destructure it. */
  data: TreeFlowNodeData;
  /** Which mode to render. The caller MUST NOT mount the tooltip in
   *  any "idle-like" state — the parent only renders us when there's
   *  something to show. */
  mode: TooltipMode;
  /** Hint for the parent about where to place the panel. The
   *  component itself does NOT compute its own placement — that
   *  responsibility lives in the parent so it can use
   *  `getBoundingClientRect()` and the live viewport. */
  position?: TooltipPosition;
  /** Cap for the full-mode body. Defaults to 400. Exposed as a prop
   *  so tests can exercise the truncation logic with shorter values
   *  without having to author 800-char strings. */
  maxFullChars?: number;
  /** Cap for the brief-mode list. Defaults to 5. */
  maxBriefItems?: number;
}

const DEFAULT_MAX_FULL = 400;
const DEFAULT_MAX_BRIEF = 5;

export function TreeNodeTooltip({
  data,
  mode,
  position = "top",
  maxFullChars = DEFAULT_MAX_FULL,
  maxBriefItems = DEFAULT_MAX_BRIEF,
}: TreeNodeTooltipProps) {
  // Defensive: if the parent passes an "idle" string (TS-typed away
  // but still possible via JS) we render nothing. The contract is
  // "the parent only mounts us in brief/full", but a misbehaving
  // parent shouldn't break the page.
  if (mode !== "brief" && mode !== "full") return null;

  return (
    <div
      role="tooltip"
      data-testid="tree-node-tooltip"
      data-mode={mode}
      data-position={position}
      // Critical F4.2 contract: never intercept clicks. The CSS rule
      // below is what makes "hover tooltip" and "F4.1 checkbox" live
      // on the same tile without fighting.
      style={{ pointerEvents: "none" }}
      className={cn(
        "absolute z-50 w-[280px] max-w-[80vw] rounded-lg border border-border bg-popover/95",
        "p-3 text-popover-foreground shadow-lg backdrop-blur-sm",
        // Fade-in + a tiny slide-in, both respect prefers-reduced-motion
        // automatically because we use the `animate-in` utilities
        // from tailwindcss-animate (which honour @media).
        "animate-in fade-in-0 zoom-in-95 duration-150",
        // Position classes. The parent can override `data-position`
        // via CSS if it needs fine-grained control.
        position === "top" && "bottom-full left-0 mb-2",
        position === "right" && "left-full top-0 ml-2",
        position === "bottom" && "top-full left-0 mt-2",
        position === "left" && "right-full top-0 mr-2"
      )}
    >
      {mode === "brief" ? <BriefContent data={data} maxItems={maxBriefItems} /> : null}
      {mode === "full" ? <FullContent data={data} maxChars={maxFullChars} /> : null}
    </div>
  );
}

// --- internals ---------------------------------------------------------

function BriefContent({
  data,
  maxItems,
}: {
  data: TreeFlowNodeData;
  maxItems: number;
}) {
  const childNames = data.childNames ?? [];
  const visible = childNames.slice(0, maxItems);
  const overflow = childNames.length - visible.length;

  return (
    <div>
      <header className="mb-1.5 flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sub-conceptos
        </h4>
        <span className="font-mono text-[10px] text-muted-foreground">
          {childNames.length}
        </span>
      </header>
      {childNames.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sin sub-conceptos en esta caja.
        </p>
      ) : (
        <ul className="space-y-0.5 text-xs leading-snug">
          {visible.map((name, i) => (
            <li
              key={`${name}-${i}`}
              data-testid="tree-node-tooltip-child"
              className="line-clamp-1 text-foreground"
            >
              <span className="mr-1.5 inline-block h-1 w-1 -translate-y-0.5 rounded-full bg-primary/60 align-middle" />
              {name}
            </li>
          ))}
          {overflow > 0 && (
            <li
              data-testid="tree-node-tooltip-overflow"
              className="pl-3 font-mono text-[10px] text-muted-foreground"
            >
              … y {overflow} más
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function FullContent({
  data,
  maxChars,
}: {
  data: TreeFlowNodeData;
  maxChars: number;
}) {
  const summary = data.summary;
  if (!summary) {
    return (
      <div>
        <header className="mb-1.5 flex items-baseline justify-between gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Corpus
          </h4>
        </header>
        <p className="text-xs italic text-muted-foreground">
          Sin contenido del corpus en esta caja todavía.
        </p>
      </div>
    );
  }
  const truncated = summary.length > maxChars;
  const body = truncated ? summary.slice(0, maxChars).trimEnd() : summary;

  return (
    <div>
      <header className="mb-1.5 flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Corpus
        </h4>
        {truncated && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {summary.length} chars
          </span>
        )}
      </header>
      <p
        data-testid="tree-node-tooltip-corpus"
        className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground"
      >
        {body}
        {truncated ? "…" : ""}
      </p>
      {truncated && (
        <p
          data-testid="tree-node-tooltip-read-more"
          className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-primary/80"
        >
          Leer más (click en la caja)
        </p>
      )}
    </div>
  );
}

export default TreeNodeTooltip;

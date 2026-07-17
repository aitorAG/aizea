"use client";

// TreeNode — the custom ReactFlow node renderer for a TopicNode.
//
// Design notes:
// - Each tile shows the node name (truncated), a one-line summary, and
//   small monospace counters for concepts and slides so the user can
//   scan the tree quickly.
// - Branch nodes (isLeaf=false) get a distinct visual treatment (left
//   accent bar) and a small "branch" badge. Leaves are quieter.
// - The selection state is reflected via a ring + a small check
//   indicator; ReactFlow passes selected=true but we add a
//   custom data-selected attribute so tests can assert on it.
// - Right-click is exposed via a context menu that the TreeViewer
//   controls — we just forward the event and let the parent decide
//   what to render (kept the actual menu component optional to keep
//   this file small and focused).

import { memo } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { GitBranch, Leaf, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TreeFlowNodeData } from "@/lib/adapters/useTreeAdapter";

function TreeNode({ data, selected }: NodeProps<TreeFlowNodeData>) {
  const isLeaf = data.isLeaf;
  const conceptCount = data.conceptCount ?? 0;
  const slideCount = data.slideCount ?? 0;

  return (
    <div
      data-testid="tree-node"
      data-selected={selected ? "true" : "false"}
      data-is-leaf={isLeaf ? "true" : "false"}
      className={cn(
        "group relative w-[220px] rounded-lg border bg-card text-card-foreground shadow-sm transition-all",
        selected
          ? "border-primary ring-2 ring-primary/40 ring-offset-1 ring-offset-background"
          : "border-border hover:border-primary/40",
        isLeaf ? "pl-3" : "pl-3"
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

      {/* Selection check */}
      {selected && (
        <span
          aria-hidden
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      )}

      <div className="p-3">
        <div className="mb-1 flex items-start justify-between gap-2">
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
        </div>

        {data.summary && (
          <p className="mb-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {data.summary}
          </p>
        )}

        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
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
    </div>
  );
}

export default memo(TreeNode);

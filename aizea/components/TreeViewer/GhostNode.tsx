"use client";

// GhostNode — placeholder node shown during tree expansion (RA1).
//
// Design notes:
// - Rendered as a ReactFlow node under each expanding leaf while
//   the server action is running (handleExpandDepth in tree-client).
// - Uses a dashed border + muted background + subtle pulse to
//   signal "this is a transient placeholder, not a real node".
// - No handles, no checkbox, no hover tooltip — it's not
//   interactive. The user sees it for at most a few seconds while
//   the LLM generates the real children.
// - The parent (TreeViewer) injects these nodes into the ReactFlow
//   graph based on `expandingLeafIds` and removes them when the
//   server action returns the new nodes.

import { memo } from "react";
import type { NodeProps } from "reactflow";
import { Loader2 } from "lucide-react";

interface GhostNodeData {
  label: string;
}

function GhostNode({ data }: NodeProps<GhostNodeData>) {
  return (
    <div
      data-testid="ghost-node"
      className="flex h-[110px] w-[220px] animate-pulse items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 bg-muted/40"
    >
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <p className="text-xs font-medium">{data.label}</p>
      </div>
    </div>
  );
}

export default memo(GhostNode);

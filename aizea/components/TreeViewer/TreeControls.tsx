"use client";

// TreeControls — the action bar that sits on top of the TreeViewer.
//
// The buttons are intentionally disabled when their action wouldn't
// make sense (e.g. "Dividir" with two nodes selected, or anything
// when nothing is selected). The "Añadir raíz" button is always
// enabled because adding a new top-level chapter is a common action
// even on a populated tree.
//
// Each button is a thin wrapper around the corresponding server
// action callback. The actual server calls live in the parent
// TreeViewer (via useTreeAdapter); this component just renders the
// visual controls and emits the semantic action.

import {
  Scissors,
  GitMerge,
  Plus,
  Trash2,
  RotateCcw,
  Sprout,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TreeControlsProps {
  selectedCount: number;
  onPrune: () => void;
  onMerge: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onAddChild: () => void;
  onAddRoot: () => void;
  onResetLayout: () => void;
  busy?: boolean;
}

export function TreeControls({
  selectedCount,
  onPrune,
  onMerge,
  onSplit,
  onDelete,
  onAddChild,
  onAddRoot,
  onResetLayout,
  busy = false,
}: TreeControlsProps) {
  const hasSelection = selectedCount > 0;
  const singleSelection = selectedCount === 1;

  return (
    <div
      role="toolbar"
      aria-label="Acciones del árbol"
      data-testid="tree-controls"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 p-2 shadow-sm backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5 border-r border-border pr-3">
        <Sprout className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {hasSelection
            ? `${selectedCount} seleccionado${selectedCount !== 1 ? "s" : ""}`
            : "Sin selección"}
        </span>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onPrune}
        disabled={!hasSelection || busy}
        aria-label="Podar seleccionados"
        title="Eliminar nodos sin hijos (Podar)"
      >
        <Scissors className="h-3.5 w-3.5" />
        Podar
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onMerge}
        disabled={selectedCount < 2 || busy}
        aria-label="Unir seleccionados"
        title="Combinar varios nodos en uno (Unir)"
      >
        <GitMerge className="h-3.5 w-3.5" />
        Unir
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSplit}
        disabled={!singleSelection || busy}
        aria-label="Dividir nodo"
        title="Dividir el nodo en dos (Dividir)"
      >
        <Scissors className="h-3.5 w-3.5 rotate-90" />
        Dividir
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAddChild}
        disabled={!singleSelection || busy}
        aria-label="Añadir hijo"
        title="Añadir un nodo hijo al seleccionado"
      >
        <Plus className="h-3.5 w-3.5" />
        Añadir hijo
      </Button>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={!hasSelection || busy}
        aria-label="Eliminar seleccionados"
        title="Eliminar los nodos seleccionados"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Eliminar
      </Button>

      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAddRoot}
          disabled={busy}
          aria-label="Añadir raíz"
          title="Añadir un nuevo capítulo raíz"
        >
          <Plus className="h-3.5 w-3.5" />
          Añadir raíz
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onResetLayout}
          aria-label="Recentrar"
          title="Recentrar la vista (reaplica el layout)"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

"use client";

// TreeControls — the action bar that sits on top of the TreeViewer.
//
// The buttons are intentionally disabled when their action wouldn't
// make sense (e.g. "Dividir" with two nodes selected, or anything
// when nothing is selected). The "Añadir raíz" button is always
// enabled because adding a new top-level chapter is a common action
// even on a populated tree.
//
// F4.1 — the multi-select model is reflected here:
//   - "Seleccionar todas" / "Deseleccionar todas" appears on the
//     left and is always enabled (when the tree has at least one
//     node). It is a TOGGLE: if not every node is currently
//     selected it selects all, otherwise it deselects all. The
//     label and the variant reflect the action that the next click
//     will perform — when all nodes are selected, the button is
//     highlighted (default/primary variant) because the click will
//     INVOKE the deselect action, not perform a selection.
//   - "Limpiar selección" appears next to it and is enabled only
//     when at least one node is selected.
//
// F4.3 — bulk slide generation:
//   - "Generar todas las diapositivas" lives on the RIGHT side of
//     the toolbar (the `ml-auto` group). It is independent of the
//     current checkbox selection: the parent is expected to ignore
//     the selection set and call the slide-generation server action
//     with every node id in the tree. The button is hidden when the
//     parent does not pass `onGenerateAllSlides`, disabled while a
//     server action is in flight (`busy`) and when the tree has zero
//     nodes, and uses the `Layers` icon to be visually distinct from
//     the per-selection generate action (which uses `Sparkles`).
//
// v1.5 / Task 3.1 — single-node edit shortcut:
//   - "Editar" sits in the same row as Podar / Unir / Dividir and
//     opens a modal editor for the SINGLE currently-selected node.
//     It is enabled only when exactly one node is selected (the
//     same `singleSelection` predicate used by "Dividir" / "Añadir
//     hijo") because editing multiple nodes at once is out of scope
//     and the user can disambiguate by un-checking the extras. The
//     parent (TreeViewer) owns the modal; the toolbar just emits
//     `onEdit` so the contract stays "this is an action button,
//     not a form".
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
  Sprout,
  ListChecks,
  XCircle,
  Layers,
  Pencil,
  Maximize2,
  Minimize2,
  ChevronsDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/components/LocaleProvider";

interface TreeControlsProps {
  selectedCount: number;
  /**
   * F4.3 — total number of nodes in the tree, regardless of the
   * checkbox selection. The "Generar todas" button is disabled when
   * this is 0 because there is nothing to generate. When omitted,
   * the button falls back to using `selectedCount`, which is wrong
   * for "Generate all" (it would disable the button when no node
   * happens to be checked) but matches the conservative
   * "favour-no-action" principle. The parent is expected to pass
   * the real tree size.
   */
  totalNodeCount?: number;
  onPrune: () => void;
  onMerge: () => void;
  onSplit: () => void;
  onDelete: () => void;
  onAddChild: () => void;
  onAddRoot: () => void;
  /**
   * v1.5 / Task 3.1 — open the edit modal for the single
   * currently-selected node. The toolbar only emits the intent;
   * the parent (TreeViewer) owns the modal and the underlying
   * server action.
   */
  onEdit: () => void;
  /** F4.1 — fill the selection set with every node id. */
  onSelectAll: () => void;
  /**
   * F4.1 — toggle button: if not every node is currently selected
   * this selects all of them; if every node is already selected
   * this empties the selection. Replaces the previous "always
   * select" semantics of the toolbar button — the parent provides
   * both `onSelectAll` and `onClearSelection` (for `Limpiar` and
   * for backward compat) and this component composes the toggle
   * locally. When this prop is omitted the button falls back to
   * the legacy "always select" behavior so older parents keep
   * working.
   */
  onToggleSelectAll?: () => void;
  /** F4.1 — empty the selection set. */
  onClearSelection: () => void;
  /**
   * F4.3 — generate slides for every node in the tree, ignoring the
   * current checkbox selection. Optional: when omitted, the
   * "Generar todas" button is not rendered (the page may not want
   * to expose the bulk action).
   */
  onGenerateAllSlides?: () => void;
  /**
   * v1.6 / Task 6 — expand the tree by one level depth, generating
   * child nodes for all current leaf nodes. Optional: when omitted,
   * the "Bajar nivel" button is not rendered.
   */
  onExpandDepth?: () => void;
  /**
   * v1.5 / Task 3.2 — when `true`, the parent (tree-client.tsx) has
   * already hidden the page header and the CheckpointBar. The
   * toolbar button shows the inverse icon (Minimize2) so the user
   * can exit fullscreen. When `onToggleFullscreen` is omitted the
   * button is not rendered — the feature is opt-in so older
   * parents keep working.
   */
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  busy?: boolean;
}

export function TreeControls({
  selectedCount,
  totalNodeCount,
  onPrune,
  onMerge,
  onSplit,
  onDelete,
  onAddChild,
  onAddRoot,
  onEdit,
  onSelectAll,
  onToggleSelectAll,
  onClearSelection,
  onGenerateAllSlides,
  onExpandDepth,
  isFullscreen = false,
  onToggleFullscreen,
  busy = false,
}: TreeControlsProps) {
  const t = useTranslations();
  const hasSelection = selectedCount > 0;
  const singleSelection = selectedCount === 1;
  // F4.1 — "all selected" means every node in the tree is in the
  // selection set. Requires both: there is at least one node
  // (otherwise the concept of "all" is undefined) AND the selection
  // count matches the total. We tolerate a missing `totalNodeCount`
  // by treating the "unknown total" case as "not all selected" —
  // conservative, but the parent normally passes it.
  const allSelected =
    typeof totalNodeCount === "number" &&
    totalNodeCount > 0 &&
    selectedCount === totalNodeCount;
  // The toolbar button is a TOGGLE: if every node is already
  // selected, the next click DESELECTS them. Otherwise the next
  // click SELECTS them all. `onToggleSelectAll` is the preferred
  // prop; when the parent doesn't pass it, we fall back to the
  // legacy `onSelectAll` for backward compat.
  const toggleSelectAll = onToggleSelectAll ?? onSelectAll;

  return (
    <div
      role="toolbar"
      aria-label={t("tree.controls.ariaLabel")}
      data-testid="tree-controls"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 p-2 shadow-sm backdrop-blur-sm"
    >
      <div className="flex items-center gap-1.5 border-r border-border pr-3">
        <Sprout className="h-3.5 w-3.5 text-muted-foreground" />
        <span
          className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
          data-testid="selection-count"
        >
          {hasSelection
             ? t(selectedCount === 1 ? "tree.selection.selectedOne" : "tree.selection.selectedMany", { count: selectedCount })
             : t("tree.selection.none")}
        </span>
      </div>

      {/* F4.1 — multi-select helper actions. The "select all" button
          is a TOGGLE: when not every node is selected the next click
          selects the rest, and when every node is selected the next
          click deselects them. The label and the variant reflect
          what the click will do: when all are selected the button
          is highlighted (default/primary) because it offers the
          inverse "deselect" action. */}
      <Button
        type="button"
        variant={allSelected ? "default" : "outline"}
        size="sm"
        onClick={toggleSelectAll}
         aria-label={allSelected ? t("tree.actions.deselectAll") : t("tree.actions.selectAll")}
        title={
          allSelected
             ? t("tree.actions.deselectAllTitle")
             : t("tree.actions.selectAllTitle")
        }
        data-testid="select-all"
      >
        <ListChecks className="h-3.5 w-3.5" />
         {allSelected ? t("tree.actions.deselectAll") : t("tree.actions.selectAll")}
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClearSelection}
        disabled={!hasSelection || busy}
         aria-label={t("tree.actions.clearSelection")}
         title={t("tree.actions.clearSelectionTitle")}
        data-testid="clear-selection"
      >
        <XCircle className="h-3.5 w-3.5" />
         {t("common.clear")}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onPrune}
        disabled={!hasSelection || busy}
         aria-label={t("tree.actions.pruneSelected")}
         title={t("tree.actions.pruneTitle")}
      >
        <Scissors className="h-3.5 w-3.5" />
         {t("tree.actions.prune")}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onMerge}
        disabled={selectedCount < 2 || busy}
         aria-label={t("tree.actions.mergeSelected")}
         title={t("tree.actions.mergeTitle")}
      >
        <GitMerge className="h-3.5 w-3.5" />
         {t("tree.actions.merge")}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onSplit}
        disabled={!singleSelection || busy}
         aria-label={t("tree.actions.splitNode")}
         title={t("tree.actions.splitTitle")}
      >
        <Scissors className="h-3.5 w-3.5 rotate-90" />
         {t("tree.actions.split")}
      </Button>

      {/* v1.5 / Task 3.1 — open the edit modal for the single
          selected node. Disabled when the selection set is not
          exactly one element (same predicate as "Dividir" /
          "Añadir hijo"). The button is a thin wrapper: the actual
          modal lives in the parent. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onEdit}
        disabled={!singleSelection || busy}
         aria-label={t("tree.actions.editSelected")}
         title={t("tree.actions.editTitle")}
        data-testid="edit-selected"
      >
        <Pencil className="h-3.5 w-3.5" />
         {t("common.edit")}
      </Button>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onAddChild}
        disabled={!singleSelection || busy}
         aria-label={t("tree.actions.addChild")}
         title={t("tree.actions.addChildTitle")}
      >
        <Plus className="h-3.5 w-3.5" />
         {t("tree.actions.addChild")}
      </Button>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onDelete}
        disabled={!hasSelection || busy}
         aria-label={t("tree.actions.deleteSelected")}
         title={t("tree.actions.deleteSelectedTitle")}
      >
        <Trash2 className="h-3.5 w-3.5" />
         {t("common.delete")}
      </Button>

      <div className="ml-auto flex items-center gap-1.5">
        {onGenerateAllSlides && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onGenerateAllSlides}
            disabled={
              busy || (totalNodeCount ?? selectedCount) === 0
            }
            aria-label={t("tree.actions.generateAllSlides")}
            title={t("tree.actions.generateAllSlidesTitle")}
            data-testid="generate-all-slides"
          >
            <Layers className="h-3.5 w-3.5" />
            {t("tree.actions.generateSlides")}
          </Button>
        )}
        {/* v1.6 / Task 6 — expand tree depth globally. Generates child
            nodes for all current leaf nodes, growing the tree by one
            level. Disabled when there are no nodes or when busy. */}
        {onExpandDepth && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExpandDepth}
            disabled={
              busy || (totalNodeCount ?? selectedCount) === 0
            }
            aria-label={t("tree.actions.expandDepth")}
            title={t("tree.actions.expandDepthTitle")}
            data-testid="expand-depth"
          >
            <ChevronsDown className="h-3.5 w-3.5" />
            {t("tree.actions.expandDepthShort")}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onAddRoot}
          disabled={busy}
          aria-label={t("tree.actions.addRoot")}
          title={t("tree.actions.addRootTitle")}
        >
          <Plus className="h-3.5 w-3.5" />
          {t("tree.actions.addRoot")}
        </Button>
        {/* v1.5 / Task 3.2 — fullscreen toggle. Sits next to
            "Añadir raíz" so it lives in the right-hand cluster of
            view-only actions. The icon flips between Maximize2
            (enter) and Minimize2 (exit) so the user always sees
            what the next click will do. Only rendered when the
            parent supplies `onToggleFullscreen` so older parents
            keep working unchanged. */}
        {onToggleFullscreen && (
          <Button
            type="button"
            variant={isFullscreen ? "default" : "ghost"}
            size="sm"
            onClick={onToggleFullscreen}
            aria-label={
              isFullscreen
                 ? t("tree.actions.exitFullscreen")
                 : t("tree.actions.fullscreen")
            }
            title={
              isFullscreen
                 ? t("tree.actions.exitFullscreenTitle")
                 : t("tree.actions.fullscreenTitle")
            }
            data-testid="toggle-fullscreen"
            aria-pressed={isFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

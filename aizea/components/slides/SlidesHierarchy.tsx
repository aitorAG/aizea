"use client";

import { useState, useMemo, memo, useCallback, type CSSProperties } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SlideThumbnail } from "@/components/slide-thumbnail";
import {
  ChevronRight,
  ChevronDown,
  Sparkles,
  Edit,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SlideGenerationStatus } from "@/lib/stores/useSlideGenerationStore";

export interface SlideSummary {
  id: string;
  title: string;
  description: string;
  order: number;
  htmlDesign?: string | null;
  hasContent: boolean;
  parentSlideId?: string | null;
}

interface TreeNode {
  slide: SlideSummary;
  children: TreeNode[];
  depth: number;
}

interface SlidesHierarchyProps {
  slides: SlideSummary[];
  totalSlides: number;
  generatingId: string | null;
  generatedIds: Set<string>;
  // v1.8 / Issue 3.4 — set of slide ids whose batch generation
  // exhausted the retry budget. The hierarchy consults this set
  // to paint a red left-border + an "Fallida" badge so the user
  // can see at-a-glance which slides still need attention.
  failedIds: Set<string>;
  // v1.10 / Wave 2 — per-slide live status map sourced from
  // `useSlideGenerationStore`. When a slide has an entry, the
  // hierarchy renders its status directly (yellow border +
  // spinner for `pending` / `generating_content` /
  // `generating_html`, green for `completed`, red for `failed`).
  //
  // The legacy `generatingId` / `generatedIds` / `failedIds`
  // props are kept as a fallback so a single-slide
  // "Generar" click (which still goes through the old
  // adapter path) renders correctly. If both sources are
  // present, the map wins — that's the case the parallel
  // batch actually drives.
  statusById?: Map<string, SlideGenerationStatus>;
  onGenerate: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (id: string) => void;
}

// v1.7 / Issue 3.1 — indentation step (matches the `28px` factor in
// the `slide-tree-item` CSS so the rail lines up with each indent
// slot regardless of tree depth).
const INDENT_STEP_PX = 28;
// Base padding applied to every row so root slides don't sit flush
// against the left edge of the list container.
const BASE_PAD_PX = 16;

function buildTree(slides: SlideSummary[]): {
  roots: TreeNode[];
  byId: Map<string, TreeNode>;
  orphanCount: number;
} {
  const byId = new Map<string, TreeNode>();
  const wrapped = slides.map((s) => ({
    slide: s,
    children: [] as TreeNode[],
    depth: 0,
  }));
  for (const n of wrapped) byId.set(n.slide.id, n);

  const roots: TreeNode[] = [];
  let orphanCount = 0;
  for (const n of wrapped) {
    const parentId = n.slide.parentSlideId ?? null;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(n);
    } else {
      if (parentId) orphanCount += 1; // parent missing in current set
      roots.push(n);
    }
  }

  // BFS to assign depth
  const queue: TreeNode[] = [...roots];
  while (queue.length > 0) {
    const node = queue.shift()!;
    for (const child of node.children) {
      child.depth = node.depth + 1;
      queue.push(child);
    }
  }

  // Sort children by order to keep stable, predictable layout
  const sortRec = (n: TreeNode) => {
    n.children.sort((a, b) => a.slide.order - b.slide.order);
    n.children.forEach(sortRec);
  };
  roots.sort((a, b) => a.slide.order - b.slide.order);
  roots.forEach(sortRec);

  return { roots, byId, orphanCount };
}

/**
 * Effective status for a slide, derived from the live
 * `statusById` map first and the legacy `isGenerating` /
 * `isGenerated` / `isFailed` flags second. The map is the
 * source of truth for the parallel batch; the flags are the
 * fallback for the single-slide "Generar" button.
 */
function deriveStatus(
  mapStatus: SlideGenerationStatus | undefined,
  isGenerating: boolean,
  isGenerated: boolean,
  isFailed: boolean
): SlideGenerationStatus | null {
  if (mapStatus) return mapStatus;
  if (isFailed) return "failed";
  if (isGenerating) return "generating_content";
  if (isGenerated) return "completed";
  return null;
}

/**
 * Map an effective status to a Tailwind border colour. Pulled
 * out of `SlideCard` so the same palette is reused by tests
 * and by Playwright assertions.
 */
function borderClassForStatus(
  status: SlideGenerationStatus | null
): string {
  if (
    status === "pending" ||
    status === "generating_content" ||
    status === "generating_html"
  ) {
    return "border-l-status-pending";
  }
  if (status === "completed") return "border-l-status-completed";
  if (status === "failed") return "border-l-status-failed";
  return "border-l-border";
}

/**
 * Map an effective status to the background wash used for the
 * body of the card. Kept very light so the title text stays
 * legible; the heavy semantic load is on the left border, the
 * wash is a secondary cue.
 */
function washClassForStatus(
  status: SlideGenerationStatus | null
): string {
  if (
    status === "pending" ||
    status === "generating_content" ||
    status === "generating_html"
  ) {
    return "bg-amber-50/40";
  }
  if (status === "failed") return "bg-red-50/60";
  return "";
}

interface SlideCardProps {
  slide: SlideSummary;
  totalSlides: number;
  isGenerating: boolean;
  isGenerated: boolean;
  // v1.8 / Issue 3.4 — when true, paint the red left-border +
  // error badge. Lives in its own prop so memoized cards don't
  // re-render when sibling failure state flips.
  isFailed: boolean;
  // v1.10 / Wave 2 — per-slide live status. When present,
  // takes priority over the `isGenerating` / `isGenerated` /
  // `isFailed` booleans (kept for the single-slide flow).
  mapStatus?: SlideGenerationStatus;
  onGenerate: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (id: string) => void;
}

const SlideCard = memo(function SlideCard({
  slide,
  totalSlides,
  isGenerating,
  isGenerated,
  isFailed,
  mapStatus,
  onGenerate,
  onEdit,
  onDelete,
  onNavigate,
}: SlideCardProps) {
  // v1.10 / Wave 2 — resolve the effective status once. The
  // legacy boolean flags are still consulted so a single-slide
  // "Generar" click (which only flips `generatingId`) renders
  // correctly even when the parallel batch is not running.
  const status = deriveStatus(
    mapStatus,
    isGenerating,
    isGenerated,
    isFailed
  );
  const borderColor = borderClassForStatus(status);
  const washColor = washClassForStatus(status);
  const isInFlight =
    status === "pending" ||
    status === "generating_content" ||
    status === "generating_html";
  const isCompleted = status === "completed";
  const isFailedNow = status === "failed";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(slide.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onNavigate(slide.id);
      }}
      data-testid={
        isFailedNow
          ? "slide-card-failed"
          : isInFlight
            ? "slide-card-generating"
            : isCompleted
              ? "slide-card-completed"
              : undefined
      }
      // v1.10 / Wave 2 — data-status is the hook the
      // `.slide-card[data-status="..."]` rule in globals.css
      // uses to paint the left border. Stable attribute name
      // regardless of which prop set the status.
      data-status={status ?? "idle"}
      data-slide-id={slide.id}
      className={cn(
        "slide-card group flex items-stretch gap-3 p-3 transition-all duration-200 hover:shadow-md",
        borderColor,
        washColor
      )}
    >
      <div className="flex items-center">
        <SlideThumbnail
          html={slide.htmlDesign ?? null}
          slideNumber={slide.order + 1}
          onClick={() => onNavigate(slide.id)}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="shrink-0 text-[11px] font-semibold tabular-nums">
              {slide.order + 1} / {totalSlides}
            </Badge>
            {isInFlight && (
              <span className="flex items-center gap-1.5 text-xs text-amber-700 animate-in fade-in">
                <Spinner size="sm" className="h-3 w-3" />
                <span className="animate-pulse">
                  {status === "generating_html"
                    ? "Generando HTML…"
                    : status === "pending"
                      ? "En cola…"
                      : "Generando contenido…"}
                </span>
              </span>
            )}
            {isCompleted && !isInFlight && !isFailedNow && (
              <span className="text-xs font-medium text-emerald-600">
                Listo
              </span>
            )}
            {/* v1.8 / Issue 3.4 + v1.10 / Wave 2 — failure badge.
                 Text is "Fallida" per the Wave 2 spec; the
                 `data-testid` stays `slide-error-badge` so the
                 v1.8.1 Playwright assertion (`errorBadges`
                 count via the same selector) continues to
                 pass. The icon is the standard AlertCircle
                 from lucide, which mirrors the visual
                 vocabulary used by the rest of the app for
                 errors. */}
            {isFailedNow && !isInFlight && (
              <span
                className="flex items-center gap-1 text-xs font-semibold text-red-700"
                data-testid="slide-error-badge"
                data-slide-status="failed"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                Fallida
              </span>
            )}
          </div>
          <h3 className="truncate text-sm font-semibold leading-tight">
            {slide.title}
          </h3>
          {slide.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {slide.description}
            </p>
          )}
        </div>

        <div onClick={(e) => e.stopPropagation()} className="pt-1.5">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onGenerate(slide.id);
              }}
              disabled={isInFlight}
            >
              {isInFlight ? (
                <Spinner size="sm" className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {isFailedNow
                  ? "Reintentar"
                  : isCompleted
                    ? "Regenerar"
                    : "Generar"}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(slide.id);
              }}
              aria-label="Editar"
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(slide.id);
              }}
              aria-label="Eliminar"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
});

interface TreeRowProps {
  node: TreeNode;
  collapsedIds: Set<string>;
  toggleCollapse: (id: string) => void;
  totalSlides: number;
  generatingId: string | null;
  generatedIds: Set<string>;
  // v1.8 / Issue 3.4 — see SlidesHierarchyProps for the
  // contract. Threaded down so the SlideCard can read it.
  failedIds: Set<string>;
  // v1.10 / Wave 2 — per-slide live status, threaded down so
  // each row can read its own status from the map. The map is
  // a new instance on every store mutation, so memoized rows
  // re-render only when their own entry changes.
  statusById?: Map<string, SlideGenerationStatus>;
  onGenerate: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (id: string) => void;
}

const TreeRow = memo(function TreeRow({
  node,
  collapsedIds,
  toggleCollapse,
  totalSlides,
  generatingId,
  generatedIds,
  failedIds,
  statusById,
  onGenerate,
  onEdit,
  onDelete,
  onNavigate,
}: TreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsedIds.has(node.slide.id);

  return (
    <div className="relative">
      {/* v1.7 / Issue 3.1 — depth-based indentation + CSS tree line.
          `data-depth` + the `--depth` CSS var feed the `::before`
          rail in app/globals.css (.slide-tree-item). Padding scales
          proportionally so 3+ level hierarchies stay aligned. */}
      <div
        className={cn("slide-tree-item relative flex items-stretch")}
        data-depth={node.depth}
        style={
          {
            paddingLeft: node.depth * INDENT_STEP_PX + BASE_PAD_PX + "px",
            "--depth": node.depth,
          } as CSSProperties
        }
      >
        {/* Card wrapper with collapse/expand toggle */}
        <div className="flex-1 py-1.5">
          <div className="flex items-stretch gap-1">
            {hasChildren && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCollapse(node.slide.id);
                }}
                className="my-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label={isCollapsed ? "Expandir" : "Colapsar"}
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? (
                  <ChevronRight className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            )}
            <div className="min-w-0 flex-1">
              <SlideCard
                slide={node.slide}
                totalSlides={totalSlides}
                isGenerating={generatingId === node.slide.id}
                isGenerated={generatedIds.has(node.slide.id) || node.slide.hasContent}
                // v1.8 / Issue 3.4 — flip the failure flag
                // based on the parent's failedIds set.
                isFailed={failedIds.has(node.slide.id)}
                // v1.10 / Wave 2 — read the per-slide live
                // status from the map. The map wins over the
                // legacy booleans via `deriveStatus` in the
                // card.
                mapStatus={statusById?.get(node.slide.id)}
                onGenerate={onGenerate}
                onEdit={onEdit}
                onDelete={onDelete}
                onNavigate={onNavigate}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Children */}
      {hasChildren && !isCollapsed && (
        <div>
          {node.children.map((child) => (
            <TreeRow
              key={child.slide.id}
              node={child}
              collapsedIds={collapsedIds}
              toggleCollapse={toggleCollapse}
              totalSlides={totalSlides}
              generatingId={generatingId}
              generatedIds={generatedIds}
              failedIds={failedIds}
              statusById={statusById}
              onGenerate={onGenerate}
              onEdit={onEdit}
              onDelete={onDelete}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
});

function SlidesHierarchy({
  slides,
  totalSlides,
  generatingId,
  generatedIds,
  failedIds,
  statusById,
  onGenerate,
  onEdit,
  onDelete,
  onNavigate,
}: SlidesHierarchyProps) {
  const { roots, orphanCount } = useMemo(() => buildTree(slides), [slides]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (slides.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="slides-hierarchy">
      {orphanCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {orphanCount} diapositiva{orphanCount !== 1 ? "s" : ""} con referencia a padre
          inexistente mostrada{orphanCount !== 1 ? "s" : ""} como raíz.
        </p>
      )}
      <div className="space-y-0">
        {roots.map((root) => (
          <TreeRow
            key={root.slide.id}
            node={root}
            collapsedIds={collapsedIds}
            toggleCollapse={toggleCollapse}
            totalSlides={totalSlides}
            generatingId={generatingId}
            generatedIds={generatedIds}
            failedIds={failedIds}
            statusById={statusById}
            onGenerate={onGenerate}
            onEdit={onEdit}
            onDelete={onDelete}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}

export {
  SlidesHierarchy,
  buildTree,
  borderClassForStatus,
  washClassForStatus,
  deriveStatus,
};
export type { SlidesHierarchyProps, TreeNode };

"use client";

// JobsPreview — v1.11 hover tooltip for the Jobs nav button.
//
// Shows a small popup listing the active jobs for the course the
// user is currently viewing (extracted from the URL). The popup
// is non-interactive (`pointer-events: none`) — clicking the
// tooltip is a no-op, and the user is expected to click the nav
// button to open the full sidebar / page.
//
// The visibility is driven by the parent (NavJobsButton). The
// parent owns the hover/focus handlers on the wrapping `relative`
// div that contains both the nav button and this preview, so the
// mouse can travel from the button into the popup without the
// popup disappearing mid-flight.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Activity, Loader2, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";
import { getJobTypeIcon, getJobTypeLabel } from "@/lib/utils/job-labels";
import { listActiveJobsAction, type ActiveJob } from "@/lib/actions/pipeline";

/** Matches `/courses/<id>...` segments so we can scope the
 *  preview to the current course. Same regex the global banner
 *  uses. */
const COURSE_PATH_RE = /^\/courses\/([^/]+?)(?:\/|$)/;

function extractCourseIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = COURSE_PATH_RE.exec(pathname);
  const id = match?.[1];
  return id && id.length > 0 ? id : null;
}

interface JobsPreviewProps {
  /** Whether the preview should be visible. Driven by the parent
   *  (NavJobsButton) so the hover bridge between the nav button
   *  and the popup is owned by the wrapper element. */
  visible: boolean;
}

const REFRESH_INTERVAL_MS = 3_000;

export function JobsPreview({ visible }: JobsPreviewProps) {
  const pathname = usePathname();
  const currentCourseId = useMemo(
    () => extractCourseIdFromPath(pathname),
    [pathname]
  );
  const [rows, setRows] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(false);
  const lastFetchedCourseId = useRef<string | null | undefined>(undefined);

  // Fetch on demand — only when the preview becomes visible and
  // the courseId has changed since the last fetch. Polling keeps
  // the data fresh while the user is reading.
  useEffect(() => {
    if (!visible) {
      lastFetchedCourseId.current = undefined;
      return;
    }
    if (lastFetchedCourseId.current === currentCourseId) {
      // Already fetched for this courseId — re-render with cached
      // data only. The user can re-hover to refresh.
      return;
    }
    lastFetchedCourseId.current = currentCourseId;
    void fetchOnce(currentCourseId, setRows, setLoading);
    const id = setInterval(() => {
      void fetchOnce(currentCourseId, setRows, setLoading);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [visible, currentCourseId]);

  // Cap the list at 5 rows to keep the tooltip small.
  const MAX_ROWS = 5;
  const visibleRows = rows.slice(0, MAX_ROWS);
  const moreCount = Math.max(0, rows.length - MAX_ROWS);

  if (!visible) return null;

  return (
    <div
      data-testid="jobs-preview"
      data-course-id={currentCourseId ?? "all"}
      data-row-count={rows.length}
      role="tooltip"
      // pointer-events-none keeps the tooltip non-interactive per
      // the spec — the user can't click individual rows, they
      // have to open the full panel.
      className={cn(
        "pointer-events-none absolute right-0 top-full z-50 mt-2 w-72",
        "rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
        "animate-in fade-in slide-in-from-top-2 duration-200"
      )}
    >
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <Activity className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">
          {currentCourseId ? "Trabajos del curso" : "Trabajos activos"}
        </span>
        <span
          className="ml-auto inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded-full bg-primary/10 px-1 font-mono text-[10px] tabular-nums text-primary"
          data-testid="jobs-preview-count"
        >
          {rows.length}
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto px-2 py-2">
        {loading && rows.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>Cargando…</span>
          </div>
        ) : rows.length === 0 ? (
          <div
            data-testid="jobs-preview-empty"
            className="flex items-center gap-2 px-2 py-3 text-[11px] text-muted-foreground"
          >
            <Inbox className="h-3.5 w-3.5" />
            <span>Sin trabajos activos.</span>
          </div>
        ) : (
          <ul className="space-y-1" data-testid="jobs-preview-list">
            {visibleRows.map((row) => {
              const Icon = getJobTypeIcon(row.phase);
              return (
                <li
                  key={row.jobId}
                  data-testid="jobs-preview-row"
                  data-job-id={row.jobId}
                  className="flex items-start gap-2 rounded-md px-2 py-1.5"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded",
                      row.status === "failed"
                        ? "bg-red-50 text-red-600"
                        : row.status === "cancelled"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-primary/10 text-primary"
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-foreground">
                      {getJobTypeLabel(row.phase)}
                    </p>
                    <p
                      className="truncate text-[10px] text-muted-foreground"
                      title={row.currentStep ?? ""}
                    >
                      {row.currentStep ?? "—"}
                    </p>
                  </div>
                  <span
                    className="font-mono text-[10px] tabular-nums font-semibold text-foreground"
                    data-testid="jobs-preview-progress"
                  >
                    {Math.min(100, Math.max(0, row.progress))}%
                  </span>
                </li>
              );
            })}
            {moreCount > 0 && (
              <li
                data-testid="jobs-preview-more"
                className="px-2 py-1 text-center text-[10px] text-muted-foreground"
              >
                +{moreCount} más — abre el panel para ver todos
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Pulsa el botón para abrir el panel completo
      </div>
    </div>
  );
}

async function fetchOnce(
  courseId: string | null,
  setRows: (rows: ActiveJob[] | ((prev: ActiveJob[]) => ActiveJob[])) => void,
  setLoading: (l: boolean | ((p: boolean) => boolean)) => void
) {
  setLoading(true);
  try {
    const result = await listActiveJobsAction(
      courseId ? { courseId } : {}
    );
    if (result.ok) {
      setRows(result.jobs);
    } else {
      setRows([]);
    }
  } catch {
    setRows([]);
  } finally {
    setLoading(false);
  }
}

"use client";

// JobsPanelContent — the shared, interactive body of the Jobs
// sidebar and the /jobs page. Renders:
//
//   1. Two tabs ("Activos" / "Finalizados") with a per-tab badge
//      count.
//   2. The active / finished rows fetched from the server, grouped
//      by course. Each row surfaces the job-type label, current
//      step, progress, elapsed time, and the three actions: Stop
//      (red), Retry (blue), Remove (gray X).
//
// Design notes:
//
//   - The active tab polls every `POLL_INTERVAL_MS` (1.5s) — the
//     same cadence the global banner uses — so a click on "Generar
//     árbol" propagates to the panel within ~1.5s without the user
//     having to refresh. The finished tab polls at the same cadence
//     for symmetry; the data shape is identical.
//
//   - The "Remove" action is purely local (a Set of dismissed
//     jobIds in component state). It does NOT mutate the pipeline
//     store, so the global banner keeps showing the job. The spec
//     calls this out explicitly: dismissing a job from the panel
//     only hides it from the panel.
//
//   - The "Stop" action calls `cancelPipelineAction` and updates
//     the local copy of the row so the spinner flips to a
//     "Cancelado" state immediately. The next poll reconciles.
//
//   - The "Retry" action calls `retryPipelineAction(jobId)`, which
//     re-runs the pipeline for the job's course. The server returns
//     the same `StartPipelineResult` a fresh run would — we
//     optimistically insert the new job ids into the local view so
//     the user sees new rows appear immediately, then the next
//     poll refreshes from the source of truth.

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  Activity,
  Loader2,
  Square,
  RefreshCcw,
  X,
  CheckCircle2,
  AlertTriangle,
  StopCircle,
  FolderOpen,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import { getJobTypeMeta } from "@/lib/utils/job-labels";
import { formatElapsed } from "@/lib/utils/format-time";
import {
  cancelPipelineAction,
  getJobStatusAction,
  listActiveJobsAction,
  listFinishedJobsAction,
  retryPipelineAction,
  type ActiveJob,
} from "@/lib/actions/pipeline";
import type { ProcessingStatus } from "@/lib/types/pipeline";

type Tab = "active" | "finished";

interface JobsPanelContentProps {
  /**
   * When set, the panel only surfaces jobs for that course. The
   * hover preview on the nav button passes the current courseId
   * (extracted from the URL); the sidebar and the /jobs page pass
   * `null` so the user sees every job across all courses.
   */
  courseIdFilter?: string | null;
  /**
   * Visual density. The sidebar uses `"sidebar"` (tighter rows);
   * the dedicated page uses `"page"` (roomier rows with more
   * padding). The default is `"sidebar"`.
   */
  variant?: "sidebar" | "page";
  /**
   * Hook fired when the active-tab count changes. The nav button
   * badge uses this to surface the total number of in-flight jobs
   * without having to subscribe to the whole panel state. Optional.
   */
  onActiveCountChange?: (count: number) => void;
  /**
   * If true, the active-tab poll stays disabled. The hover preview
   * uses this — it only reads once on mount and never refreshes
   * (the user is hovering, not watching).
   */
  disableActivePolling?: boolean;
}

const POLL_INTERVAL_MS = 1_500;

/** Group rows by course. Courses with `null` courseName / courseId
 *  are bucketed as "Sin curso" so orphan rows (e.g. from a deleted
 *  course) never get silently lost. */
function groupByCourse(
  rows: ActiveJob[]
): Array<{ courseId: string | null; courseName: string; rows: ActiveJob[] }> {
  const buckets = new Map<string, ActiveJob[]>();
  for (const row of rows) {
    const key = row.courseId ?? "orphan";
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      buckets.set(key, [row]);
    }
  }
  const out: Array<{
    courseId: string | null;
    courseName: string;
    rows: ActiveJob[];
  }> = [];
  for (const [key, members] of buckets) {
    // Course name resolution: prefer the hydrated courseName; fall
    // back to a deterministic "Curso <id>" so the UI never shows
    // an empty header.
    const courseName =
      members.find((m) => m.courseName)?.courseName ??
      (key === "orphan" ? "Sin curso" : "Curso");
    out.push({
      courseId: key === "orphan" ? null : key,
      courseName,
      rows: members,
    });
  }
  // Sort courses alphabetically by name so the order is stable
  // across re-renders. Within a course, sort newest first.
  out.sort((a, b) => a.courseName.localeCompare(b.courseName, "es"));
  for (const group of out) {
    group.rows.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return out;
}

/** Render a small status pill on each row. Drives the row's color
 *  (red for failed, amber for cancelled, emerald for completed,
 *  primary for running). */
function StatusPill({ status }: { status: ProcessingStatus }) {
  if (status === "completed") {
    return (
      <span
        data-testid="job-status"
        data-status="completed"
        className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-700"
      >
        <CheckCircle2 className="h-3 w-3" />
        Listo
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        data-testid="job-status"
        data-status="failed"
        className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-red-700"
      >
        <AlertTriangle className="h-3 w-3" />
        Falló
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span
        data-testid="job-status"
        data-status="cancelled"
        className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-800"
      >
        <StopCircle className="h-3 w-3" />
        Cancelado
      </span>
    );
  }
  return (
    <span
      data-testid="job-status"
      data-status="running"
      className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary"
    >
      <Loader2 className="h-3 w-3 animate-spin" />
      En curso
    </span>
  );
}

export function JobsPanelContent({
  courseIdFilter = null,
  variant = "sidebar",
  onActiveCountChange,
  disableActivePolling = false,
}: JobsPanelContentProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("active");
  const [activeRows, setActiveRows] = useState<ActiveJob[]>([]);
  const [finishedRows, setFinishedRows] = useState<ActiveJob[]>([]);
  const [loading, setLoading] = useState(true);
  /** Local dismiss list — the "Remove" action only hides a row from
   *  this panel, never from the global banner or the DB. Reset on
   *  tab switch? No — a job the user removed should stay removed
   *  until the page reloads. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  /** Set of jobIds whose action buttons are mid-flight, so the
   *  user can't double-click. */
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // --- Data fetch ------------------------------------------------------
  // We maintain TWO caches (active / finished) so switching tabs is
  // instant — no loading flash. Both lists poll at the same cadence
  // for simplicity; a finished row only stays "recent" for 5 minutes
  // so the list naturally drains.
  useEffect(() => {
    let cancelled = false;
    const fetchAll = async () => {
      const [activeRes, finishedRes] = await Promise.all([
        listActiveJobsAction(
          courseIdFilter ? { courseId: courseIdFilter } : {}
        ),
        listFinishedJobsAction(
          courseIdFilter ? { courseId: courseIdFilter } : {}
        ),
      ]);
      if (cancelled) return;
      if (activeRes.ok) {
        setActiveRows(activeRes.jobs);
        onActiveCountChange?.(activeRes.jobs.length);
      }
      if (finishedRes.ok) {
        setFinishedRows(finishedRes.jobs);
      }
      setLoading(false);
    };
    void fetchAll();
    const id = setInterval(() => {
      void fetchAll();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [courseIdFilter, onActiveCountChange, disableActivePolling]);

  // Drop dismissed rows from whichever list they live in.
  const visibleActive = useMemo(
    () => activeRows.filter((r) => !dismissed.has(r.jobId)),
    [activeRows, dismissed]
  );
  const visibleFinished = useMemo(
    () => finishedRows.filter((r) => !dismissed.has(r.jobId)),
    [finishedRows, dismissed]
  );

  const activeGroups = useMemo(() => groupByCourse(visibleActive), [visibleActive]);
  const finishedGroups = useMemo(() => groupByCourse(visibleFinished), [visibleFinished]);

  const activeCount = activeRows.filter((r) => !dismissed.has(r.jobId)).length;
  const finishedCount = finishedRows.filter((r) => !dismissed.has(r.jobId)).length;
  const visibleRows = tab === "active" ? visibleActive : visibleFinished;
  const visibleGroups = tab === "active" ? activeGroups : finishedGroups;

  // --- Actions ---------------------------------------------------------

  const handleStop = async (jobId: string) => {
    setPendingAction(jobId);
    // Optimistic UI: flip the local row to cancelled so the button
    // stops being clickable. The next poll reconciles if the
    // server says otherwise.
    setActiveRows((rows) =>
      rows.map((r) =>
        r.jobId === jobId
          ? {
              ...r,
              status: "cancelled" as ProcessingStatus,
              currentStep: "Cancelando…",
            }
          : r
      )
    );
    try {
      const result = await cancelPipelineAction(jobId);
      if (!result.ok) {
        toast({
          title: "No se pudo detener",
          description: result.error,
          variant: "error",
        });
        // Refresh from the source of truth so the row doesn't get
        // stuck on a fake "cancelled" state.
        try {
          const status = await getJobStatusAction(jobId);
          if (status.ok) {
            setActiveRows((rows) =>
              rows.map((r) =>
                r.jobId === jobId
                  ? {
                      ...r,
                      status: status.job.status as ProcessingStatus,
                      progress: status.job.progress,
                      currentStep: status.job.currentStep,
                      error: status.job.error,
                    }
                  : r
              )
            );
          }
        } catch {
          // best-effort
        }
      }
    } catch (err) {
      toast({
        title: "No se pudo detener",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "error",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleRetry = async (jobId: string) => {
    setPendingAction(jobId);
    // Optimistic UI: hide the row the user clicked on (we know it
    // will flip to "running" again) and rely on the next poll to
    // surface the freshly-created phase jobs.
    setDismissed((s) => {
      if (s.has(jobId)) return s;
      const next = new Set(s);
      next.add(jobId);
      return next;
    });
    try {
      const result = await retryPipelineAction(jobId);
      if (!result.ok) {
        // Roll back the optimistic dismiss so the user can try again.
        setDismissed((s) => {
          if (!s.has(jobId)) return s;
          const next = new Set(s);
          next.delete(jobId);
          return next;
        });
        toast({
          title: "No se pudo reintentar",
          description: result.error,
          variant: "error",
        });
      } else if ("empty" in result && result.empty) {
        toast({
          title: "Sin trabajo que hacer",
          description: result.message,
          variant: "info",
        });
      } else {
        toast({
          title: "Pipeline re-iniciado",
          description: "El trabajo se ha vuelto a poner en cola.",
          variant: "success",
        });
      }
    } catch (err) {
      setDismissed((s) => {
        if (!s.has(jobId)) return s;
        const next = new Set(s);
        next.delete(jobId);
        return next;
      });
      toast({
        title: "No se pudo reintentar",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "error",
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleRemove = (jobId: string) => {
    startTransition(() => {
      setDismissed((s) => {
        if (s.has(jobId)) return s;
        const next = new Set(s);
        next.add(jobId);
        return next;
      });
    });
  };

  // --- Render ----------------------------------------------------------

  const isSidebar = variant === "sidebar";

  return (
    <div className="flex h-full flex-col" data-testid="jobs-panel" data-variant={variant}>
      {/* Tab bar */}
      <div
        role="tablist"
        aria-label="Pestañas de trabajos"
        className={cn(
          "flex shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2 py-2"
        )}
        data-testid="jobs-tabs"
      >
        <TabButton
          active={tab === "active"}
          onClick={() => setTab("active")}
          count={activeCount}
          testid="tab-active"
          icon={<Activity className="h-3.5 w-3.5" />}
          label="Activos"
        />
        <TabButton
          active={tab === "finished"}
          onClick={() => setTab("finished")}
          count={finishedCount}
          testid="tab-finished"
          icon={<Inbox className="h-3.5 w-3.5" />}
          label="Finalizados"
        />
      </div>

      {/* Body */}
      <div
        className={cn(
          "flex-1 overflow-y-auto",
          isSidebar ? "px-2 py-2" : "px-4 py-4"
        )}
        data-testid="jobs-tab-body"
        data-tab={tab}
      >
        {loading ? (
          <EmptyState
            icon={<Loader2 className="h-5 w-5 animate-spin" />}
            title="Cargando…"
            variant={variant}
          />
        ) : visibleRows.length === 0 ? (
          <EmptyState
            icon={
              tab === "active" ? (
                <Activity className="h-5 w-5" />
              ) : (
                <Inbox className="h-5 w-5" />
              )
            }
            title={tab === "active" ? "Sin trabajos activos" : "Sin trabajos finalizados"}
            description={
              tab === "active"
                ? "Cuando inicies un trabajo aparecerá aquí."
                : "Los trabajos completados o cancelados recientes aparecerán aquí. Los errores permanecen visibles durante 24 h."
            }
            variant={variant}
          />
        ) : (
          <div className="space-y-4" data-testid="jobs-groups">
            {visibleGroups.map((group) => (
              <CourseGroup
                key={group.courseId ?? "orphan"}
                group={group}
                variant={variant}
                tab={tab}
                pendingAction={pendingAction}
                onStop={handleStop}
                onRetry={handleRetry}
                onRemove={handleRemove}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  count: number;
  testid: string;
  icon: React.ReactNode;
  label: string;
}

function TabButton({ active, onClick, count, testid, icon, label }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-testid={testid}
      onClick={onClick}
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        active
          ? "bg-card text-foreground shadow-sm border border-border"
          : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
      )}
    >
      {icon}
      <span>{label}</span>
      <span
        className={cn(
          "ml-0.5 inline-flex h-4 min-w-[1.25rem] items-center justify-center rounded-full px-1 font-mono text-[10px] tabular-nums",
          active
            ? "bg-primary/10 text-primary"
            : "bg-muted-foreground/15 text-muted-foreground"
        )}
        data-testid={`${testid}-count`}
        data-count={count}
      >
        {count}
      </span>
    </button>
  );
}

interface CourseGroupProps {
  group: { courseId: string | null; courseName: string; rows: ActiveJob[] };
  variant: "sidebar" | "page";
  tab: Tab;
  pendingAction: string | null;
  onStop: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onRemove: (jobId: string) => void;
}

function CourseGroup({
  group,
  variant,
  tab,
  pendingAction,
  onStop,
  onRetry,
  onRemove,
}: CourseGroupProps) {
  const isSidebar = variant === "sidebar";
  return (
    <section
      data-testid="jobs-course-group"
      data-course-id={group.courseId ?? "orphan"}
      className="space-y-1.5"
    >
      <header className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="truncate" title={group.courseName}>
          {group.courseName}
        </span>
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/70">
          {group.rows.length}
        </span>
      </header>
      <ul className="space-y-1.5" data-testid="jobs-rows">
        {group.rows.map((row) => (
          <JobRow
            key={row.jobId}
            row={row}
            variant={variant}
            tab={tab}
            pending={pendingAction === row.jobId}
            onStop={onStop}
            onRetry={onRetry}
            onRemove={onRemove}
          />
        ))}
      </ul>
    </section>
  );
}

interface JobRowProps {
  row: ActiveJob;
  variant: "sidebar" | "page";
  tab: Tab;
  pending: boolean;
  onStop: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onRemove: (jobId: string) => void;
}

function JobRow({
  row,
  variant,
  tab,
  pending,
  onStop,
  onRetry,
  onRemove,
}: JobRowProps) {
  const meta = getJobTypeMeta(row.phase);
  const Icon = meta.icon;
  const isActive = row.status === "running" || row.status === "pending";
  const isCancellable = isActive;
  const isRetryable = !isActive; // completed / failed / cancelled
  const isSidebar = variant === "sidebar";
  const progress = Math.min(100, Math.max(0, row.progress));
  const elapsedMs = Math.max(0, row.updatedAt - row.startedAt);
  // UX — failed jobs often carry long provider errors (rate limits,
  // invalid API key, network failures). One truncated line is useless
  // for diagnosing; let the user expand the full message inline.
  const [errorExpanded, setErrorExpanded] = useState(false);

  return (
    <li
      data-testid="job-row"
      data-job-id={row.jobId}
      data-status={row.status}
      data-tab={tab}
      className={cn(
        "group rounded-md border border-border bg-card",
        isSidebar ? "px-2.5 py-2" : "px-3.5 py-3",
        "transition-colors hover:bg-muted/30"
      )}
    >
      <div className="flex items-start gap-2">
        {/* Type icon */}
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md",
            isSidebar ? "h-7 w-7" : "h-8 w-8",
            row.status === "failed"
              ? "bg-red-50 text-red-600"
              : row.status === "cancelled"
                ? "bg-amber-50 text-amber-700"
                : row.status === "completed"
                  ? "bg-emerald-50 text-emerald-600"
                  : "bg-primary/10 text-primary"
          )}
        >
          <Icon className={cn(isSidebar ? "h-3.5 w-3.5" : "h-4 w-4")} />
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p
                className="truncate text-xs font-semibold text-foreground"
                data-testid="job-type"
                title={meta.label}
              >
                {meta.label}
              </p>
              <p
                className="mt-0.5 truncate text-[11px] text-muted-foreground"
                title={row.currentStep ?? ""}
              >
                {row.currentStep ?? "—"}
              </p>
            </div>
            <StatusPill status={row.status as ProcessingStatus} />
          </div>

          {/* Progress + meta */}
          <div className="mt-1.5 flex items-center gap-2">
            {isActive ? (
              <div
                className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                aria-label="Progreso"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                  style={{ width: `${progress}%` }}
                  data-testid="job-progress"
                  data-progress={Math.round(progress)}
                />
              </div>
            ) : (
              <div className="flex-1" />
            )}
            <span
              className="font-mono text-[10px] tabular-nums text-muted-foreground"
              data-testid="job-elapsed"
            >
              {formatElapsed(elapsedMs)}
            </span>
            {isActive && (
              <span
                className="font-mono text-[10px] tabular-nums font-semibold text-foreground"
                data-testid="job-progress-text"
              >
                {Math.round(progress)}%
              </span>
            )}
          </div>

          {/* Error message when failed — click to expand the full text */}
          {row.status === "failed" && row.error && (
            <button
              type="button"
              onClick={() => setErrorExpanded((v) => !v)}
              aria-expanded={errorExpanded}
              title={errorExpanded ? "Contraer" : "Ver el error completo"}
              data-testid="job-error"
              className={cn(
                "mt-1 block w-full text-left text-[10px] text-red-700",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm",
                !errorExpanded && "line-clamp-1"
              )}
            >
              {row.error}
              {!errorExpanded && (
                <span className="ml-1 font-medium underline decoration-dotted">
                  (más)
                </span>
              )}
            </button>
          )}

          {/* Actions */}
          <div
            className="mt-1.5 flex items-center justify-end gap-1"
            data-testid="job-actions"
          >
            {isCancellable && (
              <IconButton
                onClick={() => onStop(row.jobId)}
                disabled={pending}
                variant="stop"
                testid="action-stop"
                title="Detener trabajo"
                icon={<Square className="h-3 w-3" fill="currentColor" />}
              >
                Detener
              </IconButton>
            )}
            {isRetryable && row.courseId && (
              <IconButton
                onClick={() => onRetry(row.jobId)}
                disabled={pending}
                variant="retry"
                testid="action-retry"
                title="Volver a ejecutar el pipeline"
                icon={<RefreshCcw className="h-3 w-3" />}
              >
                Reintentar
              </IconButton>
            )}
            <IconButton
              onClick={() => onRemove(row.jobId)}
              disabled={pending}
              variant="remove"
              testid="action-remove"
              title="Quitar de la lista"
              icon={<X className="h-3 w-3" />}
              srLabel="Quitar de la lista"
            />
          </div>
        </div>
      </div>
    </li>
  );
}

interface IconButtonProps {
  onClick: () => void;
  disabled?: boolean;
  variant: "stop" | "retry" | "remove";
  testid: string;
  title: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
  srLabel?: string;
}

function IconButton({
  onClick,
  disabled,
  variant,
  testid,
  title,
  icon,
  children,
  srLabel,
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      title={title}
      aria-label={srLabel ?? title}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md border px-1.5 text-[10px] font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        "disabled:pointer-events-none disabled:opacity-50",
        variant === "stop" &&
          "border-amber-300 text-amber-800 hover:bg-amber-50",
        variant === "retry" &&
          "border-primary/30 text-primary hover:bg-primary/5",
        variant === "remove" &&
          "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
      )}
    >
      {icon}
      {children && <span className="hidden sm:inline">{children}</span>}
    </button>
  );
}

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  variant: "sidebar" | "page";
}

function EmptyState({ icon, title, description, variant }: EmptyStateProps) {
  return (
    <div
      data-testid="jobs-empty"
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center",
        variant === "sidebar" ? "py-10" : "py-16"
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-full border border-dashed border-border text-muted-foreground",
          variant === "sidebar" ? "h-10 w-10" : "h-12 w-12"
        )}
      >
        {icon}
      </div>
      <p
        className={cn(
          "font-medium text-foreground",
          variant === "sidebar" ? "text-xs" : "text-sm"
        )}
      >
        {title}
      </p>
      {description && (
        <p
          className={cn(
            "max-w-xs text-muted-foreground",
            variant === "sidebar" ? "text-[11px]" : "text-xs"
          )}
        >
          {description}
        </p>
      )}
    </div>
  );
}

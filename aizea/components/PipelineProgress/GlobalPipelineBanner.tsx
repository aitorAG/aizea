"use client";

// GlobalPipelineBanner — fixed-bottom banner that surfaces pipeline
// progress on every page of the app, supporting multiple concurrent
// jobs stacked vertically.
//
// Why a global banner (vs the per-page PipelineProgress sidebar)?
// The user can kick off the pipeline and then navigate around — the
// syllabus, settings, materials, even a different course. The four
// phases can take minutes, and the user must be able to see at a
// glance what's happening. A fixed banner that subscribes to the
// Zustand store solves this without coupling every page to the
// pipeline lifecycle.
//
// Multi-job design (replaces the previous single-job version):
//   - The store holds a `Map<jobId, JobInfo>`.
//   - On mount, the banner calls `listActiveJobsAction()` to
//     re-hydrate any in-flight jobs the user can't see (because
//     they navigated or refreshed). Without this, the banner
//     silently disappears across reloads.
//   - For every active (non-dismissed, non-complete) job, the
//     banner renders one `<PipelineJobBanner />` stacked vertically.
//   - Polling is shared: a single `setInterval` iterates the
//     active jobs and calls `getJobStatusAction(jobId)` for each.
//
// What this component does NOT do:
//   - Cancel the pipeline.
//   - Switch the user to a different course.
//   - Persist anything (the store is in-memory; the `dismissed`
//     flag resets on reload, by design).
//   - Auto-hide a banner. The user is always in control of
//     dismissing a completed/failed banner via the X button.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Circle,
  Loader2,
  X,
  AlertTriangle,
  Sparkles,
  RefreshCcw,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/toast";
import {
  usePipelineStore,
  getActiveJobs,
  STUCK_THRESHOLD_MS,
  type ActiveJobView,
} from "@/lib/stores/usePipelineStore";
import {
  getJobStatusAction,
  listActiveJobsAction,
  cancelPipelineAction,
} from "@/lib/actions/pipeline";
import {
  formatElapsed,
  calculateETA,
} from "@/lib/utils/format-time";
import type {
  PipelinePhase,
  ProcessingStatus,
} from "@/lib/types/pipeline";

interface PhaseDescriptor {
  id: PipelinePhase;
  label: string;
}

const PHASES: PhaseDescriptor[] = [
  { id: "segmentation", label: "Segmentando" },
  { id: "extraction", label: "Extrayendo" },
  { id: "integration", label: "Integrando" },
  { id: "tree-building", label: "Jerarquizando" },
];

const POLL_INTERVAL_MS = 2_500;
/** Vertical offset (in px) between stacked banners. The container
 *  uses flex column, but we also keep a CSS variable so tests /
 *  Playwright can introspect the actual gap. */
const BANNER_GAP_PX = 72;
/** Distance from the bottom of the viewport to the first banner. */
const BANNER_BASE_OFFSET_PX = 12;

type PhaseStatus = "pending" | "active" | "completed" | "failed";

function statusFor(
  phase: PhaseDescriptor,
  current: PipelinePhase | null,
  hasFailed: boolean
): PhaseStatus {
  if (hasFailed && phase.id === current) return "failed";
  if (!current) return "pending";
  const order = PHASES.map((p) => p.id);
  const currentIdx = order.indexOf(current);
  const myIdx = order.indexOf(phase.id);
  if (myIdx < currentIdx) return "completed";
  if (myIdx === currentIdx) return "active";
  return "pending";
}

// Hook that re-renders the component every `tickMs` while mounted.
// Used to drive the live "elapsed" counter without re-running the
// (much heavier) polling effect.
function useTick(tickMs: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => n + 1), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
}

/** Inner per-job banner. Pure presentational — receives a job view
 *  and the dismiss/close handler from the parent. */
function PipelineJobBanner({
  job,
  onDismiss,
  onRetry,
  onStop,
  index,
}: {
  job: ActiveJobView;
  onDismiss: (jobId: string) => void;
  onRetry?: (jobId: string) => void;
  onStop?: (jobId: string) => void;
  index: number;
}) {
  const isComplete = job.isComplete;
  const isCancelled = job.status === "cancelled";
  const hasFailed = job.hasFailed || job.isStuck;
  // When stuck, treat the displayed status as "failed" so the UI
  // surfaces the retry CTA.
  const displayError = job.isStuck && !job.hasFailed
    ? `El trabajo lleva más de ${Math.round(STUCK_THRESHOLD_MS / 60_000)} minutos sin avanzar. Posible fallo.`
    : job.error;

  const elapsedMs = job.startedAt ? Math.max(0, Date.now() - job.startedAt) : 0;
  const elapsedText = formatElapsed(elapsedMs);
  const etaText =
    isComplete || hasFailed || isCancelled ? null : calculateETA(elapsedMs, job.progress);

  return (
    <div
      data-testid="global-pipeline-banner"
      data-status={isCancelled
        ? "cancelled"
        : hasFailed
          ? "failed"
          : isComplete
            ? "completed"
            : "active"}
      data-job-id={job.jobId}
      data-banner-index={index}
      data-stuck={job.isStuck ? "true" : undefined}
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-xl border border-border shadow-md backdrop-blur",
        "animate-in slide-in-from-bottom-2 fade-in duration-300",
        isCancelled
          ? "border-amber-300 bg-amber-50/95 text-amber-900"
          : hasFailed
            ? "border-red-300 bg-red-50/95 text-red-900"
            : isComplete
              ? "border-emerald-300 bg-emerald-50/95 text-emerald-900"
              : "border-border bg-white/95 text-foreground"
      )}
    >
      <div className="relative mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5 sm:px-6">
        {/* Left: status icon + title */}
        <div className="flex min-w-0 items-center gap-2.5">
          {isComplete ? (
            <Check className="h-4 w-4 text-emerald-600" />
          ) : hasFailed ? (
            <AlertTriangle className="h-4 w-4 text-red-600" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" />
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">
              {isCancelled
                ? "Trabajo cancelado"
                : isComplete
                  ? "Árbol conceptual listo"
                  : hasFailed
                    ? "Falló la generación del árbol"
                    : "Generando árbol conceptual"}
            </p>
            <p className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:block">
              {job.currentStep ??
                (job.phase ? "Procesando…" : "En espera")}
            </p>
            {displayError && (
              <p
                data-testid="banner-error"
                className="mt-0.5 line-clamp-1 max-w-md text-[10px] text-red-700"
                title={displayError}
              >
                {displayError}
              </p>
            )}
          </div>
        </div>

        {/* Middle: phase chips */}
        <div className="hidden min-w-0 flex-1 items-center gap-2 lg:flex">
          <ol
            className="flex items-center gap-1.5"
            aria-label="Fases del pipeline"
          >
            {PHASES.map((p) => {
              const s = statusFor(p, job.phase, hasFailed);
              return (
                <li
                  key={p.id}
                  data-testid="phase"
                  data-status={s}
                  data-phase={p.id}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider",
                    s === "completed" &&
                      "border-emerald-200 bg-emerald-50 text-emerald-700",
                    s === "active" &&
                      "border-primary/40 bg-primary/10 text-primary",
                    s === "failed" &&
                      "border-red-300 bg-red-50 text-red-700",
                    s === "pending" &&
                      "border-border bg-muted/50 text-muted-foreground"
                  )}
                >
                  {s === "completed" ? (
                    <Check className="h-3 w-3" />
                  ) : s === "active" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : s === "failed" ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                  <span>{p.label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Right: progress + time. Right-padding leaves room for the
            absolute-positioned close button in the top-right corner. */}
        <div className="ml-auto flex items-center gap-3 pr-9 sm:pr-10">
          {/* Progress bar + percent */}
          <div className="hidden items-center gap-2 sm:flex">
            <div
              className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(job.progress)}
              aria-label="Progreso del pipeline"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500 ease-out",
                  isComplete
                    ? "bg-emerald-500"
                    : hasFailed
                      ? "bg-red-500"
                      : "bg-primary"
                )}
                style={{ width: `${Math.min(100, Math.max(0, job.progress))}%` }}
              />
            </div>
            <span
              className="min-w-[3ch] text-right font-mono text-xs font-semibold tabular-nums"
              data-testid="progress-percent"
            >
              {Math.round(job.progress)}%
            </span>
          </div>

          {/* Elapsed + ETA */}
          <div className="hidden items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground md:flex">
            <span data-testid="elapsed-time" title="Tiempo transcurrido">
              {elapsedText}
            </span>
            {etaText && (
              <>
                <span aria-hidden>·</span>
                <span data-testid="eta-time" title="Estimación restante">
                  ~{etaText}
                </span>
              </>
            )}
          </div>

          {/* Retry button — only shown for failed/stuck jobs. */}
          {hasFailed && onRetry && (
            <button
              type="button"
              onClick={() => onRetry(job.jobId)}
              data-testid="banner-retry"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium",
                "border-red-300 text-red-700 transition-colors",
                "hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              )}
            >
              <RefreshCcw className="h-3 w-3" />
              <span className="hidden sm:inline">Reintentar</span>
            </button>
          )}

          {/* Stop button — only shown for running jobs. ROOT-CAUSE
              FIX for "Banner has no Stop button". Clicking it calls
              cancelPipelineAction, which marks the ProcessingJob
              status as `cancelled` in the DB; the polling loop picks
              up the new status on the next tick. */}
          {!isComplete && !hasFailed && !isCancelled && onStop && (
            <button
              type="button"
              onClick={() => onStop(job.jobId)}
              data-testid="banner-stop"
              aria-label="Detener trabajo"
              title="Detener trabajo"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium",
                "border-amber-300 text-amber-800 transition-colors",
                "hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              )}
            >
              <Square className="h-3 w-3" fill="currentColor" aria-hidden="true" />
              <span className="hidden sm:inline">Detener</span>
            </button>
          )}
        </div>

        {/* Close button — anchored to the top-right corner of the
            banner. Absolute positioning keeps it out of the main
            flex flow so the status row never reflows when it
            changes size. Clicking it only hides the UI; the job
            keeps running in the store. */}
        <button
          type="button"
          onClick={() => onDismiss(job.jobId)}
          aria-label="Cerrar banner"
          data-testid="banner-close"
          className={cn(
            "absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md",
            "text-muted-foreground transition-colors",
            "hover:bg-foreground/10 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          )}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function GlobalPipelineBanner() {
  const { toast } = useToast();
  // We deliberately subscribe to the full Map so any change (e.g.
  // add/update/dismiss) re-renders the banner stack. For typical
  // pipelines (≤ 4 jobs) this is cheap; if the map grew large we
  // could narrow the subscription.
  const jobs = usePipelineStore((s) => s.jobs);
  const addJob = usePipelineStore((s) => s.addJob);
  const updateJob = usePipelineStore((s) => s.updateJob);
  const hydrateJobs = usePipelineStore((s) => s.hydrateJobs);
  const dismissJob = usePipelineStore((s) => s.dismissJob);

  const [hydrated, setHydrated] = useState(false);
  const completionAnnouncedRef = useRef<Set<string>>(new Set());

  // Drive the elapsed counter at 1s granularity.
  useTick(1_000);

  // --- Hydration effect ------------------------------------------------
  // On mount, fetch the list of in-flight jobs from the server and
  // register them in the store. Without this, the banner vanishes on
  // reload and the user has no idea a pipeline is still running on
  // the server. We mark the hydration done after one round so we
  // don't re-fetch on every store change.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await listActiveJobsAction();
        if (cancelled) return;
        if (result.ok && result.jobs.length > 0) {
          hydrateJobs(
            result.jobs.map((j) => ({
              jobId: j.jobId,
              courseId: j.courseId,
              phase: j.phase as PipelinePhase,
              status: j.status as ProcessingStatus,
              progress: j.progress,
              currentStep: j.currentStep,
              error: j.error,
              startedAt: j.startedAt,
              // Hydrate lastProgressAt from the server's updatedAt
              // so the stuck-job detection is honest about how
              // long the job has actually been silent.
              lastProgressAt: j.updatedAt,
            }))
          );
        }
      } catch (err) {
        // Hydration is best-effort; if it fails the polling loop
        // and any explicit addJob() calls still work.
        console.warn(
          "[GlobalPipelineBanner] hydration failed:",
          err instanceof Error ? err.message : err
        );
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateJobs]);

  // --- Polling effect --------------------------------------------------
  // A single timer iterates the active jobs and polls each. The
  // effect is keyed on `hydrated` and a stable hash of the active
  // jobIds so it only re-runs when the SET of active jobs changes
  // (a job is added, removed, or dismissed) — NOT on every store
  // update. Without this, an in-flight pollAll would update the
  // store, which would re-run the effect, which would kick off
  // another pollAll, leading to a tight loop.
  const activeKey = useMemo(() => {
    const active = getActiveJobs({ jobs });
    return active.map((j) => j.jobId).sort().join("|");
  }, [jobs]);

  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    const pollAll = async () => {
      if (cancelled) return;
      const active = getActiveJobs(usePipelineStore.getState());
      for (const job of active) {
        if (cancelled) return;
        // Don't poll completed or failed jobs — they won't change
        // until the user dismisses them.
        if (job.isComplete) continue;
        if (job.hasFailed) continue;
        try {
          const result = await getJobStatusAction(job.jobId);
          if (!result.ok) {
            // Transient API blip: keep the banner, do not flip to
            // failed. The next tick will retry.
            continue;
          }
          const data = result.job;
          usePipelineStore.getState().updateJob(job.jobId, {
            phase: data.phase as PipelinePhase,
            status: data.status as ProcessingStatus,
            progress: data.progress,
            currentStep: data.currentStep,
            error: data.error,
          });
        } catch (err) {
          // Same: don't escalate transient errors to "failed".
          console.warn(
            "[GlobalPipelineBanner] poll error:",
            err instanceof Error ? err.message : err
          );
        }
      }
    };
    const id = setInterval(pollAll, POLL_INTERVAL_MS);
    // Kick off a poll immediately so the user doesn't wait 2.5s
    // for the first update.
    void pollAll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hydrated, activeKey]);

  // --- Completion / failure toasts -------------------------------------
  // One toast per job, per (jobId × status) transition. We track
  // which completions/failures we've already announced via a ref so
  // re-renders don't double-fire.
  useEffect(() => {
    for (const [, job] of jobs) {
      if (completionAnnouncedRef.current.has(job.jobId)) continue;
      if (job.isComplete) {
        completionAnnouncedRef.current.add(job.jobId);
        toast({
          title: "Árbol conceptual generado",
          description: "El árbol está listo. Revisa la página del curso.",
          variant: "success",
        });
      } else if (job.status === "cancelled") {
        completionAnnouncedRef.current.add(job.jobId);
        toast({
          title: "Trabajo cancelado",
          description: "Has detenido el trabajo en curso.",
          variant: "info",
        });
      } else if (job.hasFailed) {
        completionAnnouncedRef.current.add(job.jobId);
        toast({
          title: "El pipeline falló",
          description:
            job.error ??
            "Se produjo un error al generar el árbol conceptual.",
          variant: "error",
        });
      }
    }
  }, [jobs, toast]);

  // Filter to active jobs and stack them.
  const active = getActiveJobs({ jobs });

  if (active.length === 0) return null;

  const handleStop = async (jobId: string) => {
    // Optimistic UI: flip the local store immediately so the button
    // stops being clickable. The server action will confirm; if it
    // fails, the next poll will reconcile.
    usePipelineStore.getState().updateJob(jobId, {
      status: "cancelled",
      progress: 0,
      currentStep: "Cancelando...",
    });
    try {
      const result = await cancelPipelineAction(jobId);
      if (!result.ok) {
        toast({
          title: "No se pudo detener",
          description: result.error,
          variant: "error",
        });
        // Force a poll to restore the canonical state.
        try {
          const status = await getJobStatusAction(jobId);
          if (status.ok) {
            usePipelineStore.getState().updateJob(jobId, {
              status: status.job.status as ProcessingStatus,
              progress: status.job.progress,
              currentStep: status.job.currentStep,
              error: status.job.error,
            });
          }
        } catch {
          // best-effort; the next polling tick will pick it up.
        }
      }
    } catch (err) {
      toast({
        title: "No se pudo detener",
        description:
          err instanceof Error ? err.message : "Error desconocido",
        variant: "error",
      });
    }
  };

  return (
    <div
      data-testid="global-pipeline-banner-stack"
      data-count={active.length}
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3"
      style={{
        bottom: `${BANNER_BASE_OFFSET_PX}px`,
      }}
    >
      {active.map((job, idx) => (
        <div
          key={job.jobId}
          className="pointer-events-auto w-full max-w-6xl"
        >
          <PipelineJobBanner
            job={job}
            index={idx}
            onDismiss={(jobId) => dismissJob(jobId)}
            onStop={handleStop}
            onRetry={(jobId) => {
              // For the root-cause fix, the "Reintentar" button
              // simply dismisses the stuck/failed banner. A real
              // retry would call startPipelineAction again, but
              // that requires a courseId which the banner may not
              // have. Marking the job as dismissed is the safest
              // default — the user can re-trigger from the tree
              // page.
              usePipelineStore.getState().removeJob(jobId);
              toast({
                title: "Trabajo descartado",
                description:
                  "Puedes volver a iniciar el pipeline desde la página del curso.",
                variant: "success",
              });
            }}
          />
        </div>
      ))}
    </div>
  );
}

// `POLL_INTERVAL_MS` is intentionally exported so future tests can
// reference the polling cadence without re-typing the magic number.
export const GLOBAL_PIPELINE_BANNER_POLL_INTERVAL_MS = POLL_INTERVAL_MS;
export const GLOBAL_PIPELINE_BANNER_GAP_PX = BANNER_GAP_PX;
export const GLOBAL_PIPELINE_BANNER_BASE_OFFSET_PX = BANNER_BASE_OFFSET_PX;

export default GlobalPipelineBanner;

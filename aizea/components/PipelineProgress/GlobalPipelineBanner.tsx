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
//   - The store holds a `Map<jobId, JobInfo>`. Each `ProcessingJob`
//     row from the DB has its own entry (one per phase).
//   - On mount, the banner calls `listActiveJobsAction()` to
//     re-hydrate any in-flight jobs the user can't see (because
//     they navigated or refreshed). Without this, the banner
//     silently disappears across reloads.
//   - Jobs are GROUPED by `runId` (a client-generated UUID the
//     "Generar árbol" click handler stamps on every phase job it
//     creates) or, as a fallback, by `courseId` for rows hydrated
//     from the server (which don't carry a runId). Each group
//     renders ONE `<PipelineJobBanner />` — the 4 phase jobs of a
//     single user-triggered pipeline run are collapsed into 1
//     banner that updates its `phase` / `progress` in place as the
//     orchestrator moves through the pipeline.
//   - Polling is shared: a single `setInterval` iterates the
//     group members and calls `getJobStatusAction(jobId)` for each,
//     so the per-job fields the banner aggregates stay fresh.
//
// What this component does NOT do:
//   - Cancel the pipeline.
//   - Switch the user to a different course.
//   - Persist anything (the store is in-memory; the `dismissed`
//     flag resets on reload, by design).
//   - Auto-hide a banner. The user is always in control of
//     dismissing a completed/failed banner via the X button.

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
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
  getBannerGroups,
  STUCK_THRESHOLD_MS,
  type ActiveJobView,
  type BannerGroup,
} from "@/lib/stores/usePipelineStore";
import {
  getJobStatusAction,
  listActiveJobsAction,
  cancelPipelineAction,
  retryPipelineAction,
} from "@/lib/actions/pipeline";
import {
  formatElapsed,
  calculateETA,
} from "@/lib/utils/format-time";
import type {
  PipelinePhase,
  ProcessingStatus,
} from "@/lib/types/pipeline";
import { useTranslations } from "@/components/LocaleProvider";

interface PhaseDescriptor {
  id: PipelinePhase;
  labelKey: `pipeline.phases.${"segmentation" | "extraction" | "integration" | "treeBuilding"}.label`;
}

const PHASES: PhaseDescriptor[] = [
  { id: "segmentation", labelKey: "pipeline.phases.segmentation.label" },
  { id: "extraction", labelKey: "pipeline.phases.extraction.label" },
  { id: "integration", labelKey: "pipeline.phases.integration.label" },
  { id: "tree-building", labelKey: "pipeline.phases.treeBuilding.label" },
];

// v1.8 / Issue 2.2 — poll more aggressively. 1.5s halves the worst
// case staleness for a fast pipeline (a course with no materials
// completes in well under a second; the previous 2.5s cadence let
// the banner get stuck on the last "active" phase chip — the user
// kept seeing "Jerarquizando" even after the orchestrator was done).
const POLL_INTERVAL_MS = 1_500;
/** Vertical offset (in px) between stacked banners. The container
 *  uses flex column, but we also keep a CSS variable so tests /
 *  Playwright can introspect the actual gap. */
const BANNER_GAP_PX = 72;
/** Distance from the bottom of the viewport to the first banner. */
const BANNER_BASE_OFFSET_PX = 12;

type PhaseStatus = "pending" | "active" | "completed" | "failed" | "stuck";

// v1.8 / Issue 2.2 — root-cause fix. The previous signature only
// considered the live `current` phase, so when a job flipped to
// `status: "completed"` (and stayed at `phase: "tree-building"` —
// the orchestrator writes the last-entered phase on the row) the
// "tree-building" chip kept rendering as `active` with a spinning
// loader, and all four chips failed to flip to `completed` together.
// We now take `isComplete` as an explicit short-circuit: when the
// job is done, every phase chip is "completed" regardless of the
// stored `phase` value.
function statusFor(
  phase: PhaseDescriptor,
  current: PipelinePhase | null,
  hasFailed: boolean,
  isComplete: boolean,
  isStuck: boolean
): PhaseStatus {
  if (isComplete) return "completed";
  if (hasFailed && phase.id === current) return "failed";
  if (isStuck && phase.id === current) return "stuck";
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
 *  and the dismiss/close handler from the parent.
 *
 *  v1.9 / Issue 1+2 — the parent now passes a `BannerGroup`
 *  (one banner per pipeline run) rather than a single `JobInfo`,
 *  so the dismiss / stop / retry handlers operate on the WHOLE
 *  group instead of a single jobId. The visible UI still keys off
 *  the representative's fields (title, phase, progress, current
 *  step), but the dismiss button dismisses the entire group and
 *  the stop button cancels the active job inside the group. */
function PipelineJobBanner({
  group,
  onDismissGroup,
  onRetryGroup,
  retrying,
  onStopActive,
  index,
}: {
  group: BannerGroup;
  onDismissGroup: (groupKey: string) => void;
  onRetryGroup?: (groupKey: string) => void;
  retrying?: boolean;
  onStopActive?: (jobId: string) => void;
  index: number;
}) {
  const t = useTranslations();
  const job = group.representative;
  // v0.12.0 / RA2.2: Use group-level aggregates for completion/failure/stuck
  // instead of just the representative. This prevents the "stuck-red latch"
  // bug: when a stuck job completes, the banner correctly turns green because
  // groupIsComplete = true and groupHasFailed = false (stuck ≠ failed).
  const isComplete = group.groupIsComplete;
  const isCancelled = job.status === "cancelled";
  const hasFailed = group.groupHasFailed;
  const isStuck = group.groupIsStuck;
  // When stuck (but not failed), show a warning message instead of treating
  // it as a hard error. The user can still retry if needed, but the banner
  // is orange/amber, not red.
  const displayError = isStuck
    ? t("pipeline.stuckDescription", { minutes: Math.round(STUCK_THRESHOLD_MS / 60_000) })
    : job.error;

  const elapsedMs = job.startedAt ? Math.max(0, Date.now() - job.startedAt) : 0;
  const elapsedText = formatElapsed(elapsedMs);
  const etaText =
    isComplete || hasFailed || isCancelled || isStuck ? null : calculateETA(elapsedMs, job.progress);

  return (
    <div
      data-testid="global-pipeline-banner"
      data-status={isCancelled
        ? "cancelled"
        : hasFailed
          ? "failed"
          : isStuck
            ? "stuck"
            : isComplete
              ? "completed"
              : "active"}
      data-job-id={job.jobId}
      data-group-key={group.groupKey}
      data-group-size={group.jobIds.length}
      data-banner-index={index}
      data-stuck={isStuck ? "true" : undefined}
      role="status"
      aria-live="polite"
      className={cn(
        "rounded-xl border border-border shadow-md backdrop-blur",
        "animate-in slide-in-from-bottom-2 fade-in duration-300",
        isCancelled
          ? "border-amber-300 bg-amber-50/95 text-amber-900"
          : hasFailed
            ? "border-red-300 bg-red-50/95 text-red-900"
            : isStuck
              ? "border-orange-300 bg-orange-50/95 text-orange-900"
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
          ) : isStuck ? (
            <AlertTriangle className="h-4 w-4 text-orange-600" />
          ) : (
            <Sparkles className="h-4 w-4 text-primary" />
          )}
          <div className="min-w-0">
            <p
              className="truncate text-sm font-semibold leading-tight"
              data-testid="banner-title"
            >
              {isCancelled
                 ? t("pipeline.banner.cancelled")
                : isComplete
                   ? t("pipeline.banner.ready")
                  : hasFailed
                     ? t("pipeline.banner.failed")
                    : isStuck
                       ? t("pipeline.banner.stuck")
                      : job.courseName
                         ? t("pipeline.banner.generatingCourse", { course: job.courseName })
                         : t("pipeline.banner.generating")}
            </p>
            <p className="hidden font-mono text-[10px] uppercase tracking-wider text-muted-foreground sm:block">
              {job.currentStep ??
                 (job.phase ? t("pipeline.status.processing") : t("pipeline.status.waiting"))}
            </p>
            {displayError && (
              <p
                data-testid="banner-error"
                className={cn(
                  "mt-0.5 line-clamp-1 max-w-md text-[10px]",
                  hasFailed ? "text-red-700" : "text-orange-700"
                )}
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
             aria-label={t("pipeline.phases.ariaLabel")}
          >
            {PHASES.map((p) => {
              const s = statusFor(p, job.phase, hasFailed, isComplete, isStuck);
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
                    s === "stuck" &&
                      "border-orange-300 bg-orange-50 text-orange-700",
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
                  ) : s === "stuck" ? (
                    <AlertTriangle className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3" />
                  )}
                   <span>{t(p.labelKey)}</span>
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
               aria-label={t("pipeline.ariaLabel")}
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-500 ease-out",
                  isComplete
                    ? "bg-emerald-500"
                    : hasFailed
                      ? "bg-red-500"
                      : isStuck
                        ? "bg-orange-500"
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
            <span data-testid="elapsed-time" title={t("pipeline.elapsed")}>
              {elapsedText}
            </span>
            {etaText && (
              <>
                <span aria-hidden>·</span>
                <span data-testid="eta-time" title={t("pipeline.eta")}>
                  ~{etaText}
                </span>
              </>
            )}
          </div>

          {/* Retry button — shown for failed/stuck jobs. v0.12.0 / RA2.2:
              stuck jobs also get a retry button (orange), not just failed
              (red). Retrying dismisses the entire group (the user can
              re-trigger from the tree page) so the operation mirrors
              the dismiss path. */}
          {(hasFailed || isStuck) && onRetryGroup && (
            <button
              type="button"
              onClick={() => onRetryGroup(group.groupKey)}
              disabled={retrying}
              aria-busy={retrying || undefined}
              data-testid="banner-retry"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 disabled:cursor-wait disabled:opacity-60",
                hasFailed
                  ? "border-red-300 text-red-700 hover:bg-red-100 focus-visible:ring-red-400"
                  : "border-orange-300 text-orange-700 hover:bg-orange-100 focus-visible:ring-orange-400"
              )}
            >
              <RefreshCcw className="h-3 w-3" />
               <span className="hidden sm:inline">{t("common.retry")}</span>
            </button>
          )}

          {/* Stop button — only shown for running jobs (not stuck, not
              failed, not completed, not cancelled). ROOT-CAUSE FIX for
              "Banner has no Stop button". Clicking it calls
              cancelPipelineAction on the active (representative) job,
              which marks that ProcessingJob's status as `cancelled` in
              the DB; the polling loop picks up the new status on the
              next tick. */}
          {!isComplete && !hasFailed && !isCancelled && !isStuck && onStopActive && (
            <button
              type="button"
              onClick={() => onStopActive(job.jobId)}
              data-testid="banner-stop"
               aria-label={t("pipeline.stop")}
               title={t("pipeline.stop")}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium",
                "border-amber-300 text-amber-800 transition-colors",
                "hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              )}
            >
              <Square className="h-3 w-3" fill="currentColor" aria-hidden="true" />
               <span className="hidden sm:inline">{t("common.stop")}</span>
            </button>
          )}
        </div>

        {/* Close button — anchored to the top-right corner of the
            banner. Absolute positioning keeps it out of the main
            flex flow so the status row never reflows when it
            changes size. Clicking it dismisses the ENTIRE group
            (all 4 phase jobs at once) — closing the "Generando
            árbol" banner should hide the whole pipeline run, not
            just one of the four phase rows. The jobs keep running
            on the server; this is a UI-only flag. */}
        <button
          type="button"
          onClick={() => onDismissGroup(group.groupKey)}
           aria-label={t("common.close")}
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

/** Matches `/courses/<id>...` segments so we can scope the
 *  hydrated jobs to the course the user is currently looking at.
 *  Accepts any non-empty id segment (Prisma uses UUIDs, but tests
 *  use slugs like "course-A", and we want to be liberal here so we
 *  do not silently miss the current course). */
const COURSE_PATH_RE = /^\/courses\/([^/]+?)(?:\/|$)/;

function extractCourseIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = COURSE_PATH_RE.exec(pathname);
  const id = match?.[1];
  return id && id.length > 0 ? id : null;
}

export function GlobalPipelineBanner() {
  const t = useTranslations();
  const { toast } = useToast();
  const [retryingGroup, setRetryingGroup] = useState<string | null>(null);
  // We deliberately subscribe to the full Map so any change (e.g.
  // add/update/dismiss) re-renders the banner stack. For typical
  // pipelines (≤ 4 jobs) this is cheap; if the map grew large we
  // could narrow the subscription.
  const jobs = usePipelineStore((s) => s.jobs);
  const addJob = usePipelineStore((s) => s.addJob);
  const updateJob = usePipelineStore((s) => s.updateJob);
  const hydrateJobs = usePipelineStore((s) => s.hydrateJobs);
  const dismissJob = usePipelineStore((s) => s.dismissJob);
  const dismissByGroupKey = usePipelineStore((s) => s.dismissByGroupKey);

  const pathname = usePathname();
  // v1.5 #2.3: scope rehydrated jobs to the current course so the
  // banner does not surface historical jobs from other courses. On
  // pages without a courseId (home, settings, etc.) we fall back to
  // no courseId filter, which keeps the banner honest about any
  // globally-relevant in-flight work.
  const currentCourseId = useMemo(
    () => extractCourseIdFromPath(pathname),
    [pathname]
  );

  const [hydratedCourseId, setHydratedCourseId] = useState<string | null | undefined>(undefined);
  const hydrated = hydratedCourseId === currentCourseId;
  // Responses started before a retry cannot reconcile the newly accepted run.
  const retryGenerationRef = useRef(0);
  const completionAnnouncedRef = useRef<Set<string>>(new Set());

  // Drive the elapsed counter at 1s granularity.
  useTick(1_000);

  // --- Hydration effect ------------------------------------------------
  // On mount (and whenever the user navigates to a different course),
  // fetch the list of currently-active jobs from the server scoped to
  // the current course and register them in the store. Without this,
  // the banner vanishes on reload and the user has no idea a pipeline
  // is still running on the server.
  //
  // v1.5 #2.3: passing `courseId` here is the actual fix for the
  // "all historical jobs appear on reload" complaint. The server-side
  // filter is the source of truth — a fresh page load now only
  // surfaces jobs that belong to the course in the URL. We mark the
  // hydration done after one round so we don't re-fetch on every
  // store change.
  useEffect(() => {
    let cancelled = false;
    const retryGeneration = retryGenerationRef.current;
    (async () => {
      try {
        const result = await listActiveJobsAction(
          currentCourseId ? { courseId: currentCourseId } : {}
        );
        if (cancelled || retryGeneration !== retryGenerationRef.current) return;
        if (result.ok && result.jobs.length > 0) {
          hydrateJobs(
            result.jobs.map((j) => ({
              jobId: j.jobId,
              courseId: j.courseId,
              courseName: j.courseName,
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
        if (!cancelled) setHydratedCourseId(currentCourseId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrateJobs, currentCourseId]);

  // --- Discovery re-list effect ---------------------------------------
  // The pipeline runs IN-PROCESS and synchronously inside
  // `startPipelineAction` (BullMQ was removed in MOD-04). While it
  // runs, the PipelineService writes each phase's ProcessingJob row
  // to the DB in real time (each startPhase/updateProgress is an
  // immediate commit, visible to other connections via SQLite WAL).
  //
  // The tree-client only holds a synthetic `pending:${runId}`
  // placeholder until the action RETURNS (which, for a synchronous
  // 1-3 min pipeline, is when everything is already `completed`).
  // Without re-listing, the banner polls the fake placeholder id,
  // gets `!ok`, and the progress bar sits at 0% "Iniciando pipeline…"
  // for the whole run — even though the server is making progress.
  //
  // Fix: while there is any in-flight job for the current course,
  // re-list active jobs by courseId on a short interval so the real
  // phase rows are DISCOVERED and hydrated into the store as soon as
  // the pipeline creates them. This is purely client-side and works
  // identically in local dev and the desktop build (both run the
  // same in-process pipeline).
  const hasInflight = useMemo(() => {
    for (const job of jobs.values()) {
      if (job.dismissed) continue;
      if (job.status === "pending" || job.status === "running") return true;
    }
    return false;
  }, [jobs]);

  useEffect(() => {
    if (!hydrated) return;
    if (!hasInflight) return;
    if (!currentCourseId) return;
    let cancelled = false;
    let listing = false;
    const relist = async () => {
      if (cancelled || listing) return;
      listing = true;
      const retryGeneration = retryGenerationRef.current;
      const courseJobs = Array.from(usePipelineStore.getState().jobs.values()).filter(
        (job) => !job.dismissed && job.courseId === currentCourseId &&
          (job.status === "pending" || job.status === "running")
      );
      const inheritedRunId = courseJobs.find((job) => job.jobId.startsWith("pending:") && job.runId)?.runId
        ?? courseJobs.find((job) => job.runId)?.runId;
      const placeholders = courseJobs.filter((job) =>
        job.jobId.startsWith("pending:") && job.runId === (inheritedRunId ?? null)
      );
      try {
        const result = await listActiveJobsAction({
          courseId: currentCourseId,
        });
        if (cancelled || retryGeneration !== retryGenerationRef.current ||
          !result.ok || result.jobs.length === 0) return;
        // Inherit the runId of the placeholder (or any in-flight job)
        // for this course so the discovered real phase rows collapse
        // into the SAME banner group as the placeholder. Without this
        // the placeholder groups under `run:${runId}` while the
        // server rows (no runId) group under `course:${courseId}`,
        // producing two stacked banners for one run.
        const discoveredJobs = result.jobs.filter((job) => job.courseId === currentCourseId);
        const discoveredRows = discoveredJobs.map((j) => ({
            jobId: j.jobId,
            runId: usePipelineStore.getState().jobs.get(j.jobId)?.runId ?? inheritedRunId,
            courseId: j.courseId,
            courseName: j.courseName,
            phase: j.phase as PipelinePhase,
            status: j.status as ProcessingStatus,
            progress: j.progress,
            currentStep: j.currentStep,
            error: j.error,
            startedAt: j.startedAt,
            lastProgressAt: j.updatedAt,
          }));
        hydrateJobs(discoveredRows);
        // Once real phase rows have been discovered, drop the
        // synthetic placeholder so the banner stops showing a
        // stalled "Iniciando pipeline…" row alongside the real one.
        const store = usePipelineStore.getState();
        if (discoveredRows.some((job) => (job.runId ?? null) === (inheritedRunId ?? null))) {
          for (const placeholder of placeholders) {
            if (store.jobs.get(placeholder.jobId) === placeholder) store.removeJob(placeholder.jobId);
          }
        }
      } catch {
        // best-effort; the per-job poll loop still runs
      } finally {
        listing = false;
      }
    };
    const id = setInterval(relist, POLL_INTERVAL_MS);
    void relist();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [hydrated, hasInflight, currentCourseId, hydrateJobs]);

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
  // One toast per pipeline run, per (groupKey × terminal-status)
  // transition. We track which (groupKey × status) combinations
  // we've already announced via a ref so re-renders don't
  // double-fire. v1.9 / Issue 2: the announcement used to fire
  // per-job, so a 4-phase pipeline produced up to 4 success
  // toasts. Now we fire exactly ONE toast per pipeline run, keyed
  // on the groupKey so concurrent runs in different courses don't
  // collide.
  // v0.12.0 / RA2.2: Use group-level aggregates (groupIsComplete,
  // groupHasFailed) instead of just the representative, so the toast
  // fires when the WHOLE group reaches a terminal state, not just
  // when the representative does.
  useEffect(() => {
    const groups = getBannerGroups({ jobs });
    for (const group of groups) {
      const rep = group.representative;
      const terminalKey = `${group.groupKey}:${rep.status}`;
      if (completionAnnouncedRef.current.has(terminalKey)) continue;
      if (group.groupIsComplete) {
        completionAnnouncedRef.current.add(terminalKey);
        toast({
          title: t("pipeline.toast.completed"),
          description: t("pipeline.toast.completedDescription"),
          variant: "success",
        });
      } else if (rep.status === "cancelled") {
        completionAnnouncedRef.current.add(terminalKey);
        toast({
          title: t("pipeline.toast.cancelled"),
          description: t("pipeline.toast.cancelledDescription"),
          variant: "info",
        });
      } else if (group.groupHasFailed) {
        completionAnnouncedRef.current.add(terminalKey);
        toast({
          title: t("pipeline.toast.failed"),
          description:
            rep.error ??
            t("pipeline.toast.failedDescription"),
          variant: "error",
        });
      }
    }
  }, [jobs, toast, t]);

  // Group active jobs by runId (or courseId as a fallback). The
  // banner renders ONE row per group, collapsing the 4 phase jobs
  // of a single user-triggered pipeline run into a single banner
  // that updates its phase / progress in place. This is the v1.9
  // / Issue 2 fix — the previous design rendered 1 banner per
  // phase, stacking 4 banners during a real run.
  const groups = getBannerGroups({ jobs });

  if (groups.length === 0) return null;

  const handleStop = async (jobId: string) => {
    // Optimistic UI: flip the local store immediately so the button
    // stops being clickable. The server action will confirm; if it
    // fails, the next poll will reconcile.
    usePipelineStore.getState().updateJob(jobId, {
      status: "cancelled",
      progress: 0,
      currentStep: t("cancelling"),
    });
    try {
      const result = await cancelPipelineAction(jobId);
      if (!result.ok) {
        console.error("[pipeline] stop action failed:", result.error);
        toast({
          title: t("stopJobError"),
          description: t("unknownError"),
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
      console.error("[pipeline] stop action threw:", err);
      toast({
        title: t("stopJobError"),
        description:
          t("unknownError"),
        variant: "error",
      });
    }
  };

  return (
    <div
      data-testid="global-pipeline-banner-stack"
      data-count={groups.length}
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-3"
      style={{
        bottom: `${BANNER_BASE_OFFSET_PX}px`,
      }}
    >
      {groups.map((group, idx) => (
        <div
          key={group.groupKey}
          className="pointer-events-auto w-full max-w-6xl"
        >
          <PipelineJobBanner
            group={group}
            index={idx}
            onDismissGroup={(groupKey) => dismissByGroupKey(groupKey)}
            onStopActive={(jobId) => handleStop(jobId)}
            retrying={retryingGroup === group.groupKey}
            onRetryGroup={(groupKey) => {
              if (retryingGroup !== null) return;

              const retryGroup = groups.find((candidate) => candidate.groupKey === groupKey);
              if (!retryGroup) return;

               completionAnnouncedRef.current.add(
                 `${groupKey}:${retryGroup.representative.status}`
               );
               setRetryingGroup(groupKey);
               retryGenerationRef.current += 1;
              void retryPipelineAction(retryGroup.representative.jobId)
                .then((result) => {
                  if (!result.ok) {
                    console.error("[pipeline] retry action failed:", result.error);
                    toast({
                      title: t("retryJobError"),
                      description: t("unknownError"),
                      variant: "error",
                    });
                    return;
                  }

                  if (result.empty) {
                    toast({
                      title: t("pipeline.noContent"),
                      description: t("pipeline.noContent"),
                      variant: "info",
                    });
                    return;
                  }

                  // Keep a visual row for the accepted run until discovery
                  // finds its real phase jobs. The discriminated union keeps
                  // runId inaccessible in the empty branch above.
                   const placeholderJobId = `pending:${result.runId}`;
                   retryGenerationRef.current += 1;
                  const representative = retryGroup.representative;
                  const store = usePipelineStore.getState();
                  store.addJob({
                    jobId: placeholderJobId,
                    runId: result.runId,
                    courseId: representative.courseId,
                    courseName: representative.courseName,
                    phase: "segmentation",
                    status: "pending",
                    progress: 0,
                    currentStep: t("pipeline.status.starting"),
                    startedAt: Date.now(),
                  });
                  store.removeByGroupKey(groupKey);
                  toast({
                    title: t("pipeline.toast.retryStarted"),
                    description: t("pipeline.toast.retryDescription"),
                    variant: "success",
                  });
                })
                .catch((err: unknown) => {
                  console.error("[pipeline] retry action threw:", err);
                  toast({
                    title: t("retryJobError"),
                    description:
                      t("unknownError"),
                    variant: "error",
                  });
                })
                .finally(() => setRetryingGroup(null));
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

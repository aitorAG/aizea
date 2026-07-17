"use client";

// PipelineProgress — a four-phase status board for the structural pipeline.
//
// Design notes:
// - Each phase is rendered as a numbered step in a vertical timeline so the
//   user can read it top-to-bottom and feel the "pipeline moving forward".
// - The currently active phase is marked with the primary accent and a thin
//   bar; completed phases are checked; pending ones are dimmed.
// - Errors live in a quieter footnote section so they don't fight the
//   timeline for attention. The whole component is small enough to drop
//   into a sidebar next to the TreeViewer.
//
// The component is read-only — it subscribes to usePipelineStore and
// reflects whatever the store has. All mutations live in the store and
// the actions that call it.
//
// Multi-job support: the sidebar takes an optional `jobId` prop. When
// provided, it shows the progress for that specific job. When omitted,
// it falls back to the first non-dismissed job in the store. The
// global banner is the source of truth for "all jobs"; this sidebar
// is the per-page detail view for whichever job the user is focused
// on (e.g. the one belonging to the course they're looking at).

import { Check, Circle, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  usePipelineStore,
  type JobInfo,
} from "@/lib/stores/usePipelineStore";
import type { PipelinePhase } from "@/lib/types/pipeline";

interface PhaseDescriptor {
  id: PipelinePhase;
  label: string;
  description: string;
}

const PHASES: PhaseDescriptor[] = [
  {
    id: "segmentation",
    label: "Segmentando",
    description: "Dividimos el documento en unidades semánticas.",
  },
  {
    id: "extraction",
    label: "Extrayendo",
    description: "Identificamos conceptos, fórmulas y figuras.",
  },
  {
    id: "integration",
    label: "Integrando",
    description: "Agrupamos conceptos en temas cohesivos.",
  },
  {
    id: "tree-building",
    label: "Jerarquizando",
    description: "Construimos el árbol conceptual del curso.",
  },
];

type PhaseStatus = "pending" | "active" | "completed";

function statusFor(phase: PipelinePhase, current: PipelinePhase | null): PhaseStatus {
  if (!current) return "pending";
  const order = PHASES.map((p) => p.id);
  const currentIdx = order.indexOf(current);
  const myIdx = order.indexOf(phase);
  if (myIdx < currentIdx) return "completed";
  if (myIdx === currentIdx) return "active";
  return "pending";
}

interface PhaseRowProps {
  descriptor: PhaseDescriptor;
  index: number;
  status: PhaseStatus;
  isLast: boolean;
}

function PhaseRow({ descriptor, index, status, isLast }: PhaseRowProps) {
  const isActive = status === "active";
  const isCompleted = status === "completed";

  return (
    <li
      data-testid="phase"
      data-status={status}
      data-phase={descriptor.id}
      className="relative flex gap-3 pb-5 last:pb-0"
    >
      {/* Spine */}
      {!isLast && (
        <span
          aria-hidden
          className={cn(
            "absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px",
            isCompleted ? "bg-primary/60" : "bg-border"
          )}
        />
      )}

      {/* Bullet */}
      <span
        className={cn(
          "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-mono font-semibold transition-colors",
          isActive &&
            "border-primary bg-primary text-primary-foreground shadow-[0_0_0_4px_hsl(var(--primary)/0.12)]",
          isCompleted && "border-primary/60 bg-primary/10 text-primary",
          !isActive && !isCompleted && "border-border bg-card text-muted-foreground"
        )}
      >
        {isCompleted ? (
          <Check className="h-4 w-4" />
        ) : isActive ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span>{String(index + 1).padStart(2, "0")}</span>
        )}
      </span>

      {/* Body */}
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={cn(
              "text-sm font-medium",
              isActive ? "text-foreground" : "text-foreground/80"
            )}
          >
            {descriptor.label}
          </p>
          {isActive && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-primary">
              En curso
            </span>
          )}
          {isCompleted && (
            <span className="font-mono text-[10px] uppercase tracking-wider text-primary/70">
              Hecho
            </span>
          )}
        </div>
        <p
          className={cn(
            "mt-0.5 text-xs leading-relaxed",
            isActive ? "text-muted-foreground" : "text-muted-foreground/70"
          )}
        >
          {descriptor.description}
        </p>
      </div>
    </li>
  );
}

interface PipelineProgressProps {
  /** Optional title shown above the timeline. */
  title?: string;
  /** Optional className to extend the container. */
  className?: string;
  /** Optional jobId to scope the sidebar to a single job. When
   *  omitted, falls back to the first non-dismissed job in the
   *  store. */
  jobId?: string | null;
}

/** Pick a job to display in the sidebar. Prefers the explicit
 *  `jobId` prop; otherwise picks the first non-dismissed job. */
function pickJob(jobs: Map<string, JobInfo>, jobId?: string | null): JobInfo | null {
  if (jobId) {
    const j = jobs.get(jobId);
    if (j) return j;
  }
  for (const j of jobs.values()) {
    if (!j.dismissed) return j;
  }
  return null;
}

export function PipelineProgress({
  title = "Pipeline estructural",
  className,
  jobId = null,
}: PipelineProgressProps) {
  const jobs = usePipelineStore((s) => s.jobs);
  const job = pickJob(jobs, jobId);

  const phase = job?.phase ?? null;
  const progress = job?.progress ?? 0;
  const currentStep = job?.currentStep ?? null;
  const error = job?.error ?? null;
  const isComplete = job?.isComplete ?? false;
  const isFailed = job?.hasFailed ?? false;

  const activeIdx = PHASES.findIndex((p) => p.id === phase);

  return (
    <section
      aria-label="Progreso del pipeline"
      data-testid="pipeline-progress"
      data-job-id={job?.jobId ?? null}
      className={cn(
        "rounded-lg border border-border bg-card p-5 shadow-sm",
        className
      )}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {isComplete
              ? "Trabajo finalizado"
              : isFailed
                ? "Trabajo fallido"
                : job
                  ? `Fase ${activeIdx + 1} de ${PHASES.length}`
                  : "En espera"}
          </p>
        </div>
        {isComplete && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            <Check className="h-3 w-3" /> Completado
          </span>
        )}
        {isFailed && (
          <span
            data-testid="pipeline-progress-failed"
            className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-red-700"
          >
            <AlertTriangle className="h-3 w-3" /> Error
          </span>
        )}
      </header>

      {/* Progress bar */}
      <div className="mb-5">
        <div className="mb-1.5 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {currentStep ?? (phase ? "Procesando..." : "Sin iniciar")}
          </span>
          <span className="font-mono text-xs font-semibold tabular-nums text-foreground">
            {Math.round(progress)}%
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress)}
          aria-label="Progreso del pipeline"
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              isComplete
                ? "bg-emerald-500"
                : isFailed
                  ? "bg-red-500"
                  : "bg-primary"
            )}
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
      </div>

      {/* Phase timeline */}
      <ol className="m-0 list-none p-0">
        {PHASES.map((descriptor, i) => (
          <PhaseRow
            key={descriptor.id}
            descriptor={descriptor}
            index={i}
            status={statusFor(descriptor.id, phase)}
            isLast={i === PHASES.length - 1}
          />
        ))}
      </ol>

      {/* Error */}
      {error && (
        <div
          data-testid="error-list"
          className="mt-4 rounded-md border border-destructive/20 bg-destructive/5 p-3"
        >
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            Error
          </div>
          <ul className="m-0 list-none space-y-1 p-0">
            <li className="font-mono text-xs leading-relaxed text-destructive/90">
              · {error}
            </li>
          </ul>
        </div>
      )}

      {/* Empty hint when nothing is happening */}
      {!job && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          <Circle className="h-3.5 w-3.5" />
          El pipeline se inicia al subir un nuevo material al curso.
        </div>
      )}
    </section>
  );
}

export default PipelineProgress;

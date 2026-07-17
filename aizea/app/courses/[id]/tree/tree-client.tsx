"use client";

// TreePageClient — the interactive part of /courses/[id]/tree.
//
// Responsibilities:
//  - Hold the current TopicNode[] (loaded by the server component) and
//    propagate edits from the TreeViewer up via `onTreeChange`.
//  - Render the TreeViewer.
//  - Render the PipelineProgress when an active job is supplied (the
//    page passes jobId/phase from the server).
//  - Wire the "Generar slides desde selección" button to the slide
//    server actions, so the user can ship the tree straight to the
//    slide pipeline.
//
// The component is intentionally thin: any complex logic lives in the
// server actions and the TreeViewer.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, GitBranch, Sparkles, FilePlus2 } from "lucide-react";
import { TreeViewer } from "@/components/TreeViewer/TreeViewer";
import { PipelineProgress } from "@/components/PipelineProgress/PipelineProgress";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/toast";
import { useTreeAdapter } from "@/lib/adapters/useTreeAdapter";
import { usePipelineStore } from "@/lib/stores/usePipelineStore";
import { startPipelineAction } from "@/lib/actions/pipeline";
import { createSlide } from "@/lib/actions/slide";
import type { PipelinePhase, TopicNode } from "@/lib/types/pipeline";

interface TreePageClientProps {
  courseId: string;
  courseName: string;
  initialNodes: TopicNode[];
  activeJobId?: string | null;
  activeJobPhase?: PipelinePhase | null;
}

export function TreePageClient({
  courseId,
  courseName,
  initialNodes,
  activeJobId = null,
  activeJobPhase = null,
}: TreePageClientProps) {
  const [nodes, setNodes] = useState<TopicNode[]>(initialNodes);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [startingPipeline, setStartingPipeline] = useState(false);
  const { toast } = useToast();

  const adapter = useTreeAdapter(nodes);
  const addJob = usePipelineStore((s) => s.addJob);

  // When the page receives an activeJobId from the server, register
  // it in the store. The GlobalPipelineBanner (mounted in
  // app/layout.tsx) takes over polling from there — its own
  // `listActiveJobsAction` rehydrates any in-flight jobs on mount,
  // so we also re-register this server-provided job to keep the
  // local view in sync.
  useEffect(() => {
    if (!activeJobId || !activeJobPhase) {
      return;
    }
    addJob({
      jobId: activeJobId,
      courseId,
      phase: activeJobPhase,
    });
  }, [activeJobId, activeJobPhase, addJob, courseId]);

  const handleTreeChange = useCallback((next: TopicNode[]) => {
    setNodes(next);
  }, []);

  const handleSelection = useCallback(
    (ids: string[]) => {
      setSelectedIds(ids);
    },
    []
  );

  const handleGenerate = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setGenerating(true);
    try {
      const created: { id: string; title: string }[] = [];
      for (const id of selectedIds) {
        const node = nodes.find((n) => n.id === id);
        if (!node) continue;
        const slide = await createSlide(
          courseId,
          node.name,
          node.summary ?? ""
        );
        created.push({ id: slide.id, title: slide.title });
      }
      toast({
        title: "Diapositivas generadas",
        description: `Se crearon ${created.length} diapositiva${created.length !== 1 ? "s" : ""} a partir de los nodos seleccionados.`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Error al generar",
        description:
          err instanceof Error ? err.message : "No se pudieron crear las diapositivas.",
        variant: "error",
      });
    } finally {
      setGenerating(false);
    }
  }, [courseId, selectedIds, nodes, toast]);

  const handleStartPipeline = useCallback(async () => {
    setStartingPipeline(true);
    try {
      const result = await startPipelineAction(courseId);
      if (!result.ok) {
        toast({
          title: "Error al iniciar el pipeline",
          description: result.error,
          variant: "error",
        });
        return;
      }
      const jobs = result.jobs;
      const store = usePipelineStore.getState();
      const now = Date.now();

      // When the pipeline had nothing to do (course has no materials
      // / no extracted units), only the segmentation jobId is set.
      // We still register it in the store so the user sees the
      // completed banner; the toast below tells them WHY there is no
      // tree.
      if (result.empty) {
        if (jobs.segmentationJobId) {
          store.addJob({
            jobId: jobs.segmentationJobId,
            courseId,
            phase: "segmentation",
            status: "completed",
            progress: 100,
            currentStep: "Sin unidades que procesar",
            startedAt: now,
          });
        }
        toast({
          title: "Sin contenido que procesar",
          description: result.message,
          variant: "info",
        });
        return;
      }

      // Normal happy path: register the four phase jobs in the
      // store. The server has already created the rows and the
      // orchestrator's run() has returned the ids; the banner will
      // hydrate the rest of the status (progress/error) via its
      // own polling loop. Registering them optimistically means the
      // user sees the banner immediately rather than waiting for
      // the first poll.
      store.addJob({
        jobId: jobs.segmentationJobId,
        courseId,
        phase: "segmentation",
        startedAt: now,
      });
      store.addJob({
        jobId: jobs.extractionJobId,
        courseId,
        phase: "extraction",
        startedAt: now,
      });
      store.addJob({
        jobId: jobs.integrationJobId,
        courseId,
        phase: "integration",
        startedAt: now,
      });
      store.addJob({
        jobId: jobs.treeBuildingJobId,
        courseId,
        phase: "tree-building",
        startedAt: now,
      });
      toast({
        title: "Pipeline iniciado",
        description: "El árbol se está generando. Te avisaremos cuando termine.",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Error al iniciar el pipeline",
        description:
          err instanceof Error ? err.message : "No se pudo iniciar el pipeline.",
        variant: "error",
      });
    } finally {
      setStartingPipeline(false);
    }
  }, [courseId, toast]);

  const hasTree = nodes.length > 0;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-3 p-3 sm:p-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/courses/${courseId}/materials`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {courseName}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight">
            <GitBranch className="h-6 w-6 text-primary" />
            Árbol conceptual
          </h1>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {hasTree
              ? `${nodes.length} nodo${nodes.length !== 1 ? "s" : ""} · selección: ${selectedIds.length}`
              : "Sin árbol todavía"}
          </p>
        </div>

        {hasTree && selectedIds.length > 0 && (
          <Button
            onClick={handleGenerate}
            disabled={generating}
            size="default"
            data-testid="generate-slides-button"
          >
            {generating ? (
              <Spinner size="sm" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generating
              ? "Generando..."
              : `Generar ${selectedIds.length} diapositiva${selectedIds.length !== 1 ? "s" : ""}`}
          </Button>
        )}
      </div>

      {/* Empty state — no tree yet, prompt the user to start the pipeline. */}
      {!hasTree && (
        <div className="flex flex-1 items-center justify-center p-6" data-testid="empty-tree">
          <EmptyState
            icon={<GitBranch className="h-10 w-10" />}
            title="El árbol está vacío"
            description="Sube un material al curso y ejecuta el pipeline para generar el árbol conceptual automáticamente."
            action={
              <Button
                onClick={handleStartPipeline}
                loading={startingPipeline}
                size="lg"
              >
                <FilePlus2 className="h-4 w-4" />
                Generar árbol
              </Button>
            }
          />
        </div>
      )}

      {/* Active pipeline progress (only if a job is running) */}
      {hasTree && activeJobId && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr,320px]">
          <div className="min-h-[60vh] flex-1 overflow-hidden rounded-lg border border-border bg-card">
            <TreeViewer
              nodes={nodes}
              onChange={handleTreeChange}
              onGenerateSlides={handleSelection}
            />
          </div>
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <PipelineProgress />
          </aside>
        </div>
      )}

      {/* No active job — TreeViewer takes the full width */}
      {hasTree && !activeJobId && (
        <div className="min-h-[70vh] flex-1 overflow-hidden rounded-lg border border-border bg-card">
          <TreeViewer
            nodes={nodes}
            onChange={handleTreeChange}
            onGenerateSlides={handleSelection}
          />
        </div>
      )}
    </div>
  );
}

export default TreePageClient;

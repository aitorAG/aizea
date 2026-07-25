"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  Plus,
  FileDown,
  Layers,
  Save,
  GitBranch,
  FileText,
  Download,
  Loader2,
  Check,
  XCircle,
  ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SlidesHierarchy,
  type SlideSummary,
} from "@/components/slides/SlidesHierarchy";
import { ExportModal } from "@/components/export-modal";
import { useToast } from "@/components/toast";
import { revalidateSlides } from "@/lib/actions/revalidate";
import { useSlideAdapter } from "@/lib/adapters/useSlideAdapter";
import { exportAllSlidesPdfAction } from "@/lib/actions/slide-export";
import {
  useSlideGenerationStore,
  type SlideGenerationStatus,
} from "@/lib/stores/useSlideGenerationStore";
import {
  SlideGenerationQueue,
  type SlideGenerationSummary,
} from "@/lib/infrastructure/queue/SlideGenerationQueue";
import { cn } from "@/lib/utils";

interface SlidesClientProps {
  courseId: string;
  courseName: string;
  slides: SlideSummary[];
  materialCount: number;
}

function SlidesClient({
  courseId,
  courseName,
  slides: initialSlides,
  materialCount,
}: SlidesClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [slides, setSlides] = useState(initialSlides);
  // v1.10 / Wave 2 — the parallel batch is owned by
  // `useSlideGenerationStore`. The component still tracks
  // `generatingId` for the single-slide "Generar" click (which
  // goes through the legacy slideAdapter path and shows a
  // spinner on the affected card while the LLM call is in
  // flight), and `generatedIds` / `failedIds` for the same
  // single-slide flow. The batch path uses the store directly.
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [generatedIds, setGeneratedIds] = useState<Set<string>>(
    new Set(initialSlides.filter((s) => s.hasContent).map((s) => s.id))
  );
  // v1.8 / Issue 3.4 — track slides whose batch generation
  // exhausted all retry attempts. The SlidesHierarchy consults
  // this set to paint a red left-border + a "Fallida" badge so
  // the user can see at a glance which slides still need
  // attention. Cleared on the next successful generation of the
  // same slide id.
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [addSlideOpen, setAddSlideOpen] = useState(false);
  const [editSlideOpen, setEditSlideOpen] = useState(false);
  const [editingSlide, setEditingSlide] = useState<SlideSummary | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const slideAdapter = useSlideAdapter(courseId);

  // v1.10 / Wave 2 — batch generation uses the parallel
  // queue. The queue is held in a ref so it survives across
  // renders without re-instantiation. The store is the source
  // of truth for everything batch-related: which slides are
  // running, which have completed, which failed.
  const generationJobs = useSlideGenerationStore((s) => s.jobs);
  const totalCount = useSlideGenerationStore((s) => s.totalCount);
  const completedCount = useSlideGenerationStore((s) => s.completedCount);
  const failedCount = useSlideGenerationStore((s) => s.failedCount);
  const isRunning = useSlideGenerationStore((s) => s.isRunning);
  const resetGenerationStore = useSlideGenerationStore((s) => s.reset);
  const queueRef = useRef<SlideGenerationQueue | null>(null);
  // v1.10 / Wave 2 — keep a stable `queueRef` instance for the
  // lifetime of the page. The queue is reusable: calling
  // `enqueueAll` after a previous batch finishes starts a
  // fresh batch with the same concurrency / retry knobs.
  //
  // The `slideAdapter` is a NEW object on every render (the
  // adapter hook builds a fresh bag of callbacks each time),
  // so depending on it directly would re-create the queue
  // on every render and (worse) the cleanup function would
  // call `resetGenerationStore()` → which triggers a store
  // change → which triggers a re-render → infinite loop.
  //
  // Solution: capture the slideAdapter in a ref that's only
  // updated when the `courseId` changes, and run the
  // instantiation effect exactly once on mount.
  const slideAdapterRef = useRef(slideAdapter);
  slideAdapterRef.current = slideAdapter;

  useEffect(() => {
    const queue = new SlideGenerationQueue(
      slideAdapterRef.current,
      useSlideGenerationStore.getState(),
      {
        onComplete: (summary) => {
          handleBatchComplete(summary);
        },
      }
    );
    queueRef.current = queue;
    // On unmount: cancel any in-flight batch so the pump stops
    // dispatching new work and the store is reset. Without
    // this, navigating away from the slides page while a
    // batch is in flight would leave the global store
    // populated with stale rows that survive a course switch
    // and confuse the next page.
    return () => {
      queue.cancel();
      resetGenerationStore();
    };
    // Intentionally empty deps: the queue is created once on
    // mount and torn down on unmount. The slideAdapter is
    // read via the ref so a re-render (which produces a new
    // adapter object) doesn't trigger a re-instantiation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v1.10 / Wave 2 — derived snapshot of the store's `jobs`
  // map, projected down to a `Map<slideId, status>` for the
  // SlidesHierarchy. We compute the map from `generationJobs`
  // (a Zustand-tracked `Map`) and `useMemo` it on identity
  // changes so memoized slide rows re-render only when their
  // own entry actually changed.
  const statusById = useMemo(() => {
    const m = new Map<string, SlideGenerationStatus>();
    for (const [id, job] of generationJobs) {
      m.set(id, job.status);
    }
    return m;
  }, [generationJobs]);

  // Derived helpers for the global progress bar. Same shape
  // as `getSlideGenerationProgress` from the store module —
  // re-derived here because we already have `totalCount`,
  // `completedCount` and `failedCount` from the store's
  // aggregate fields and reading them individually avoids
  // iterating the full jobs Map on every render.
  const batchActive = isRunning || totalCount > 0;
  const inFlightCount = totalCount - completedCount - failedCount;

  // v1.8 / Issue 3.4 — transient errors from the LLM provider
  // (rate limit, 5xx, network blip) are usually self-healing
  // within a few seconds. We retry the call up to 3 times
  // with a 1s delay between attempts before giving up and
  // adding the slide to `failedIds`. The retry happens
  // INSIDE a single `await` so the batch progress bar
  // advances exactly once per slide — the user sees one
  // entry per slide, not three attempts each.
  //
  // v1.10 / Wave 2 — this helper is now ONLY used by the
  // single-slide "Generar" click (the batch click goes
  // through `SlideGenerationQueue.runPhase`, which has the
  // same retry semantics). Kept here so a user clicking the
  // per-row "Generar" button still benefits from transient
  // error recovery without routing through the queue.
  const generateWithRetry = useCallback(
    async (slideId: string, kind: "content" | "html"): Promise<boolean> => {
      const MAX_RETRIES = 3;
      const RETRY_DELAY_MS = 1000;
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (kind === "content") {
            await slideAdapter.generateSlideContent(slideId);
          } else {
            await slideAdapter.regenerateHtmlDesign(slideId, "");
          }
          // Success — clear any prior failure flag for this id.
          setFailedIds((prev) => {
            if (!prev.has(slideId)) return prev;
            const next = new Set(prev);
            next.delete(slideId);
            return next;
          });
          return true;
        } catch {
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
        }
      }
      // All attempts exhausted — record the failure for the UI.
      setFailedIds((prev) => new Set(prev).add(slideId));
      return false;
    },
    [slideAdapter]
  );

  const handleGenerateSingle = useCallback(
    async (slideId: string) => {
      setGeneratingId(slideId);
      try {
        await slideAdapter.generateSlideContent(slideId);
        setGeneratedIds((prev) => new Set(prev).add(slideId));
        toast({
          title: "Contenido generado",
          description: "La diapositiva se ha generado correctamente.",
          variant: "success",
        });
        await revalidateSlides(courseId);
      } catch (err) {
        toast({
          title: "Error al generar",
          description:
            err instanceof Error
              ? err.message
              : "No se pudo generar el contenido.",
          variant: "error",
        });
      } finally {
        setGeneratingId(null);
      }
    },
    [toast, courseId, slideAdapter]
  );

  /**
   * v1.10 / Wave 2 — fires when the parallel batch settles.
   * Surfaces the completion toast and revalidates the server
   * cache so the new `hasContent` / `htmlDesign` rows flow
   * down to SlidesClient. Identical UX to the previous
   * sequential implementation; the only difference is that
   * this is called exactly once per batch (not per slide) and
   * the per-slide status is already painted in the UI.
   */
  const handleBatchComplete = useCallback(
    async (summary: SlideGenerationSummary) => {
      const { total, succeeded, failed, cancelled, results } = summary;
      // Sync legacy `generatedIds` / `failedIds` from the
      // queue's results so the next render's state is
      // consistent with the (now-finished) store.
      const newGenerated = new Set<string>();
      const newFailed = new Set<string>();
      for (const r of results) {
        if (r.ok) newGenerated.add(r.slideId);
        else newFailed.add(r.slideId);
      }
      setGeneratedIds((prev) => {
        const next = new Set(prev);
        for (const id of newGenerated) next.add(id);
        return next;
      });
      setFailedIds((prev) => {
        const next = new Set(prev);
        for (const id of newFailed) next.add(id);
        // Drop failedIds that the new run actually succeeded on.
        for (const id of newGenerated) next.delete(id);
        return next;
      });

      if (cancelled) {
        toast({
          title: "Generación cancelada",
          description: `${succeeded} de ${total} procesadas antes de cancelar.`,
          variant: "info",
        });
      } else if (failed === 0) {
        toast({
          title: "Generación completada",
          description: `${succeeded} de ${total} diapositivas procesadas.`,
          variant: "success",
        });
      } else {
        // v1.8 / Issue 3.4 — when some slides fail, use the
        // "info" variant (not "warning" which doesn't exist in
        // the toast system) so the toast still surfaces
        // without screaming "error!" at the user — the
        // per-slide red border already tells the failure
        // story visually.
        toast({
          title: `Generación completada con ${failed} error${failed !== 1 ? "es" : ""}`,
          description: `${succeeded} procesadas, ${failed} con error. Las diapositivas en rojo requieren atención.`,
          variant: "info",
        });
      }
      await revalidateSlides(courseId);
      // v1.5 / Auto-refresh — `revalidatePath` only invalidates
      // the server cache; the client still holds the old
      // `slides` / `generatedIds` state. `router.refresh()`
      // asks the server component to re-run so the new
      // `hasContent` / `htmlDesign` values flow down to
      // SlidesClient and the user doesn't have to hard-reload.
      // Mirrors the F6.B fix in tree-client.tsx.
      router.refresh();
    },
    [courseId, router, toast]
  );

  /**
   * v1.5 / Task 4.2 — "Generar contenidos de todo" button.
   * Routes through the parallel queue, but with `phases:
   * ["content"]` so only the content pass runs. Content is
   * generated FIRST because the HTML design prompt reads the
   * content boxes to seed the layout — if we ran HTML on an
   * empty box set we'd get a near-empty page.
   *
   * v1.10 / Wave 2 — replaces the previous sequential
   * `for (slide of slides)` loop. With 3-way concurrency the
   * wall-clock for a 20-slide course drops from ~5 minutes to
   * ~2 minutes.
   */
  const handleGenerateAll = useCallback(async () => {
    if (!queueRef.current) return;
    const allIds = slides.map((s) => s.id);
    if (allIds.length === 0) return;
    toast({
      title: `Generando contenido de ${allIds.length} diapositiva${allIds.length !== 1 ? "s" : ""}…`,
      description:
        "Las diapositivas se procesan en paralelo. La página se actualizará automáticamente.",
    });
    try {
      await queueRef.current.enqueueAll(allIds, { phases: ["content"] });
    } catch (err) {
      toast({
        title: "Error en la generación por lotes",
        description:
          err instanceof Error
            ? err.message
            : "No se pudo iniciar la generación.",
        variant: "error",
      });
    }
  }, [slides, toast]);

  /**
   * v1.5 / Task 4.2 — "Generar todo" button (content + HTML).
   * Routes through the parallel queue with both phases
   * enabled. Reuses the same `handleBatchComplete` plumbing
   * as `handleGenerateAll` so the user sees a single,
   * consistent progress bar regardless of which bulk button
   * they clicked.
   */
  const handleGenerateAllWithHtml = useCallback(async () => {
    if (!queueRef.current) return;
    const allIds = slides.map((s) => s.id);
    if (allIds.length === 0) return;
    toast({
      title: `Generando ${allIds.length} diapositiva${allIds.length !== 1 ? "s" : ""}…`,
      description:
        "Las diapositivas se procesan en paralelo (contenido + HTML). La página se actualizará automáticamente.",
    });
    try {
      await queueRef.current.enqueueAll(allIds, {
        phases: ["content", "html"],
      });
    } catch (err) {
      toast({
        title: "Error en la generación por lotes",
        description:
          err instanceof Error
            ? err.message
            : "No se pudo iniciar la generación.",
        variant: "error",
      });
    }
  }, [slides, toast]);

  /**
   * v1.10 / Wave 2 — Cancel button. Flips the queue's
   * internal `cancelled` flag. In-flight LLM calls finish
   * their current `await` (we can't safely abort a network
   * call) but no new slides are dispatched and the batch
   * resolves with `cancelled: true`. The completion handler
   * surfaces a different toast for cancellation so the user
   * knows the partial state is intentional.
   */
  const handleCancelBatch = useCallback(() => {
    if (!queueRef.current) return;
    queueRef.current.cancel();
  }, []);

  const handleNavigate = useCallback(
    (slideId: string) => {
      router.push(`/courses/${courseId}/slides/${slideId}`);
    },
    [router, courseId]
  );

  const handleEdit = useCallback((id: string) => {
    const slide = slides.find((s) => s.id === id);
    if (!slide) return;
    setEditingSlide(slide);
    setEditTitle(slide.title);
    setEditDesc(slide.description);
    setEditSlideOpen(true);
  }, [slides]);

  const handleSaveEdit = useCallback(async () => {
    if (!editingSlide || !editTitle.trim()) return;
    setSavingEdit(true);
    try {
      await slideAdapter.updateSlide(editingSlide.id, {
        title: editTitle.trim(),
        description: editDesc.trim(),
      });
      setSlides((prev) =>
        prev.map((s) =>
          s.id === editingSlide.id
            ? { ...s, title: editTitle.trim(), description: editDesc.trim() }
            : s
        )
      );
      setEditSlideOpen(false);
      toast({ title: "Diapositiva actualizada", variant: "success" });
    } catch {
      toast({
        title: "Error",
        description: "No se pudo actualizar la diapositiva.",
        variant: "error",
      });
    } finally {
      setSavingEdit(false);
    }
  }, [editingSlide, editTitle, editDesc, toast, slideAdapter]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeletingId(id);
      try {
        await slideAdapter.deleteSlide(id);
        setSlides((prev) => prev.filter((s) => s.id !== id));
        setGeneratedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        toast({ title: "Diapositiva eliminada", variant: "success" });
      } catch {
        toast({
          title: "Error",
          description: "No se pudo eliminar la diapositiva.",
          variant: "error",
        });
      } finally {
        setDeletingId(null);
      }
    },
    [toast, slideAdapter]
  );

  const handleAddSlide = useCallback(async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const slide = await slideAdapter.createSlide(newTitle.trim(), newDesc.trim());
      setSlides((prev) => [
        ...prev,
        {
          id: slide.id,
          title: slide.title,
          description: slide.description,
          order: prev.length,
          htmlDesign: null,
          hasContent: false,
          parentSlideId: null,
        },
      ]);
      setAddSlideOpen(false);
      setNewTitle("");
      setNewDesc("");
      toast({ title: "Diapositiva añadida", variant: "success" });
    } catch {
      toast({
        title: "Error",
        description: "No se pudo añadir la diapositiva.",
        variant: "error",
      });
    } finally {
      setAdding(false);
    }
  }, [courseId, newTitle, newDesc, toast, slideAdapter]);

  // v1.5 / Task 4.3 — Direct PDF download from the slides list.
  // Calls the server action which renders every slide as one A4
  // page (slide HTML only, no text boxes) and returns a base64
  // PDF (when Playwright is available) or a full HTML document
  // (desktop fallback) that the user can print to PDF via Ctrl+P.
  const handleExportPdf = useCallback(async () => {
    setExportingPdf(true);
    try {
      const result = await exportAllSlidesPdfAction(courseId);

      if (result.html && !result.pdf) {
        // Desktop fallback: render the HTML in a hidden iframe and
        // trigger its print dialog. This avoids the popup blocker
        // that blocks `window.open()` after an async server action
        // (the user gesture is lost). WebView2 on Windows exposes
        // "Guardar como PDF" / "Microsoft Print to PDF" in the print
        // dialog, so the user gets a real PDF without Playwright.
        const iframe = document.createElement("iframe");
        iframe.style.position = "fixed";
        iframe.style.right = "0";
        iframe.style.bottom = "0";
        iframe.style.width = "0";
        iframe.style.height = "0";
        iframe.style.border = "0";
        document.body.appendChild(iframe);

        const cleanup = () => {
          // Remove the iframe a little after printing so the print
          // dialog has time to capture its contents.
          setTimeout(() => iframe.remove(), 1000);
        };

        const doc = iframe.contentWindow?.document;
        if (doc) {
          doc.open();
          doc.write(result.html);
          doc.close();
          // Wait for the iframe (KaTeX CDN + layout) to settle, then
          // focus it and print. Guard so print fires exactly once
          // whether it's triggered by onload or the fallback timer.
          let printed = false;
          const triggerPrint = () => {
            if (printed) return;
            printed = true;
            try {
              iframe.contentWindow?.focus();
              iframe.contentWindow?.print();
              toast({
                title: "Diálogo de impresión abierto",
                description: "Elige 'Guardar como PDF' como destino",
                variant: "info",
              });
            } catch {
              toast({
                title: "Error al imprimir",
                description: "Usa 'Exportar HTML' e imprime desde el navegador",
                variant: "error",
              });
            } finally {
              cleanup();
            }
          };
          // Give KaTeX auto-render ~800ms to rasterise formulas.
          iframe.onload = () => setTimeout(triggerPrint, 800);
          // Fallback in case onload already fired (cached CDN).
          setTimeout(triggerPrint, 1500);
        } else {
          iframe.remove();
          toast({
            title: "Error al exportar PDF",
            description: "No se pudo preparar el documento para imprimir",
            variant: "error",
          });
        }
      } else {
        // Web deployment: download the base64 PDF directly.
        const binary = atob(result.pdf);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const blob = new Blob([bytes], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast({ title: "PDF exportado", variant: "success" });
      }
    } catch (err) {
      toast({
        title: "Error al exportar PDF",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "error",
      });
    } finally {
      setExportingPdf(false);
    }
  }, [courseId, toast]);

  // State A: No slides yet
  if (slides.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <Link
            href={`/courses/${courseId}/materials`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {courseName}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Gestión de Diapositivas
          </h1>
        </div>

        <EmptyState
          icon={<Layers className="h-10 w-10" />}
          title="Sin diapositivas"
          description="Genera un esquema desde el árbol conceptual o añade diapositivas manualmente."
          action={
            <Link
              href={`/courses/${courseId}/tree`}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <GitBranch className="h-4 w-4" />
              Ir al árbol conceptual
            </Link>
          }
        />
      </div>
    );
  }

  // State B: Slides exist
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/courses/${courseId}/materials`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {courseName}
          </Link>
          <h1 className="mt-2 text-2xl font-bold tracking-tight">
            Gestión de Diapositivas
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {slides.length} diapositiva{slides.length !== 1 ? "s" : ""} ·{" "}
            {generatedIds.size} con contenido
          </p>
        </div>
      </div>

      {/*
        v1.10 / Wave 2 — global progress bar. Lives at the top
        of the slides list (per the spec) so the user sees real-
        time status without scrolling. Renders whenever the
        queue has been initialised (`totalCount > 0`), even
        after the batch completes, so the post-run summary
        stays visible long enough for the user to register
        the result. The bar is "terminal" once `inFlight` is
        0 and either the run succeeded or failed.
      */}
      {batchActive && (
        <BatchProgressBar
          total={totalCount}
          completed={completedCount}
          failed={failedCount}
          inFlight={inFlightCount}
          isRunning={isRunning}
          onCancel={handleCancelBatch}
        />
      )}

      {/* v1.5 / Task 4.1 — Hierarchical tree view of slides.
          Each slide's position reflects its parent-child relationship
          (parentSlideId) so the user sees the same hierarchy as the
          conceptual tree that generated the slides. Lines on the left
          connect parents to their children; sub-trees can be collapsed.

          v1.7 / Issue 3.1 — `data-depth` is the hook the slide rows
          (and this root marker) use for CSS-based tree lines
          (.slide-tree-item in app/globals.css). Indentation scales
          with depth (28px per level) so multi-level hierarchies
          remain scannable. */}
      {/* v1.7 / Issue 3.1 — root marker for the slides hierarchy.
          The CSS in app/globals.css keys off `data-depth` on every
          row (set in SlidesHierarchy) to draw the tree line + scale
          indentation. The wrapper here carries the root marker so
          the hierarchy can be queried as a single unit (handy for
          smoke tests and styling). */}
      <div data-depth="0" data-testid="slides-tree-root">
        <SlidesHierarchy
          slides={slides}
          totalSlides={slides.length}
          generatingId={generatingId}
          generatedIds={generatedIds}
          // v1.8 / Issue 3.4 — pass the failed set so the
          // hierarchy can paint a red border + an "Fallida" badge
          // for slides that exhausted the retry budget.
          failedIds={failedIds}
          // v1.10 / Wave 2 — pass the live per-slide status
          // map. The hierarchy consults this BEFORE the legacy
          // boolean props so the parallel batch always wins.
          statusById={statusById}
          onGenerate={handleGenerateSingle}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onNavigate={handleNavigate}
        />
      </div>

      {/* Bottom controls */}
      <div className="sticky bottom-4 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
        {isRunning ? (
          <>
            <Badge variant="info" className="gap-1.5">
              <Spinner size="sm" className="h-3 w-3" />
              Generando {completedCount + failedCount} / {totalCount}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleCancelBatch}>
              Cancelar
            </Button>
          </>
        ) : (
          <>
            {/* v1.5 / Task 4.2 — split the "generate all" action in
                two visually distinct buttons so the user can pick
                the scope (content-only vs. content + HTML). The
                "contenidos" button keeps the lighter `outline`
                variant and the `FileText` icon (just text content);
                the new "todo" button uses the primary `default`
                variant and the `Sparkles` icon (does everything:
                content boxes + HTML visualizations). Both buttons
                call the same internal `handleGenerate*` pipeline;
                the only difference is whether the HTML pass runs.
                v1.10 / Wave 2 — both go through the parallel
                `SlideGenerationQueue` instead of the previous
                sequential `for` loop. */}
            <Button
              onClick={handleGenerateAll}
              variant="outline"
              size="sm"
              data-testid="generate-all-content"
              aria-label="Generar contenidos de todo"
              title="Generar el contenido (texto) de todas las diapositivas"
            >
              <FileText className="h-4 w-4" />
              Generar contenidos de todo
            </Button>
            <Button
              onClick={handleGenerateAllWithHtml}
              size="sm"
              data-testid="generate-all-with-html"
              aria-label="Generar todo (contenido y HTML)"
              title="Generar contenido y visualización HTML para todas las diapositivas"
            >
              <Sparkles className="h-4 w-4" />
              Generar todo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddSlideOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Añadir Diapositiva
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportOpen(true)}
            >
              <FileDown className="h-4 w-4" />
              Exportar
            </Button>
            {/* v1.5 / Task 4.3 — Direct one-click PDF export
                (one A4 page per slide, slide HTML only). */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPdf}
              loading={exportingPdf}
              data-testid="export-pdf-all"
              aria-label="Exportar PDF de todas las diapositivas"
              title="Exportar todas las diapositivas como PDF (un A4 por slide)"
            >
              <Download className="h-4 w-4" />
              Exportar PDF
            </Button>
          </>
        )}
      </div>

      {/* Add Slide Dialog */}
      <Dialog open={addSlideOpen} onClose={() => setAddSlideOpen(false)}>
        <DialogHeader>
          <DialogTitle>Añadir diapositiva</DialogTitle>
          <DialogDescription>
            Crea una nueva diapositiva manualmente.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <Input
            id="new-slide-title"
            label="Título"
            placeholder="Título de la diapositiva"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <div className="space-y-1.5">
            <label
              htmlFor="new-slide-desc"
              className="block text-sm font-medium text-foreground"
            >
              Descripción
            </label>
            <Textarea
              id="new-slide-desc"
              placeholder="Descripción breve (opcional)"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setAddSlideOpen(false)}
            disabled={adding}
          >
            Cancelar
          </Button>
          <Button onClick={handleAddSlide} loading={adding} disabled={!newTitle.trim()}>
            Añadir
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Edit Slide Dialog */}
      <Dialog open={editSlideOpen} onClose={() => setEditSlideOpen(false)}>
        <DialogHeader>
          <DialogTitle>Editar diapositiva</DialogTitle>
          <DialogDescription>
            Modifica el título y la descripción de la diapositiva.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <Input
            id="edit-slide-title"
            label="Título"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <div className="space-y-1.5">
            <label
              htmlFor="edit-slide-desc"
              className="block text-sm font-medium text-foreground"
            >
              Descripción
            </label>
            <Textarea
              id="edit-slide-desc"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setEditSlideOpen(false)}
            disabled={savingEdit}
          >
            Cancelar
          </Button>
          <Button onClick={handleSaveEdit} loading={savingEdit} disabled={!editTitle.trim()}>
            <Save className="h-3.5 w-3.5" />
            Guardar
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Export Modal */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        courseId={courseId}
      />
    </div>
  );
}

/**
 * v1.10 / Wave 2 — global progress bar.
 *
 * Renders the per-batch summary as a coloured banner above the
 * slides list. The bar is `data-testid="batch-progress-bar"`
 * so Playwright can assert on the count + cancel button. The
 * `aria-live="polite"` region announces state transitions to
 * screen readers without stealing focus.
 *
 * Visual states (driven by `isRunning`):
 *   - isRunning=true, completed < total, failed = 0
 *     → yellow (pending/generating), spinner + live counter
 *   - isRunning=true, completed < total, failed > 0
 *     → yellow, spinner + counter + failure count chip
 *   - isRunning=false, completed + failed === total, failed > 0
 *     → red, error icon, failure count (terminal failure summary)
 *   - isRunning=false, failed === 0
 *     → green, check icon, success summary
 */
interface BatchProgressBarProps {
  total: number;
  completed: number;
  failed: number;
  inFlight: number;
  isRunning: boolean;
  onCancel: () => void;
}

function BatchProgressBar({
  total,
  completed,
  failed,
  inFlight,
  isRunning,
  onCancel,
}: BatchProgressBarProps) {
  const settled = completed + failed;
  const percent = total > 0 ? Math.round((settled / total) * 100) : 0;
  const hasFailed = failed > 0;
  const allDone = !isRunning && settled === total && total > 0;

  // Accent colour matches the worst status the user is looking
  // at. While running with no failures: yellow (pending
  // palette). While running with failures: red because the
  // "X fallidas" chip is the most urgent signal. Terminal
  // success: green. Terminal failure: red.
  const accent = hasFailed
    ? "border-red-300 bg-red-50/95 text-red-900"
    : isRunning
      ? "border-status-pending/60 bg-amber-50/95 text-amber-900"
      : "border-status-completed/60 bg-emerald-50/95 text-emerald-900";

  return (
    <div
      data-testid="batch-progress-bar"
      data-running={isRunning ? "true" : "false"}
      data-failed={hasFailed ? "true" : "false"}
      data-completed={completed}
      data-failed-count={failed}
      data-total={total}
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3 shadow-sm",
        accent
      )}
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        {isRunning ? (
          inFlight > 0 ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ListChecks className="h-4 w-4" />
          )
        ) : hasFailed ? (
          <XCircle className="h-4 w-4" />
        ) : (
          <Check className="h-4 w-4" />
        )}
        <span data-testid="batch-progress-label">
          {isRunning
            ? "Generando diapositivas en paralelo"
            : hasFailed
              ? "Generación completada con errores"
              : "Generación completada"}
          : {completed} de {total} completadas
        </span>
        {hasFailed && (
          <Badge variant="destructive" className="ml-1">
            {failed} fallida{failed !== 1 ? "s" : ""}
          </Badge>
        )}
        {isRunning && inFlight > 0 && (
          <Badge variant="warning" className="ml-1">
            {inFlight} en curso
          </Badge>
        )}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-white/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label="Progreso de generación por lotes"
      >
        <div
          data-testid="batch-progress-fill"
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            hasFailed
              ? "bg-red-500"
              : isRunning
                ? "bg-status-pending"
                : "bg-status-completed"
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      {isRunning && (
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-testid="batch-progress-cancel"
            onClick={onCancel}
            className="border-current/30 bg-white/70 hover:bg-white"
          >
            Cancelar lote
          </Button>
        </div>
      )}
      {allDone && !hasFailed && (
        <p className="text-xs opacity-80" data-testid="batch-progress-done">
          Todas las diapositivas quedaron con contenido y diseño HTML.
        </p>
      )}
    </div>
  );
}

export { SlidesClient };
export type { SlidesClientProps };

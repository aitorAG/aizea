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
  Check,
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
  isSlideFullyGenerated,
  type SlideSummary,
} from "@/components/slides/SlidesHierarchy";
import { ExportModal } from "@/components/export-modal";
import { useToast } from "@/components/toast";
import { revalidateSlides } from "@/lib/actions/revalidate";
import { useSlideAdapter } from "@/lib/adapters/useSlideAdapter";
import { exportAllSlidesPdfAction, exportAllSlidesPptAction } from "@/lib/actions/slide-export";
import { getSettingsAction } from "@/lib/actions/settings";
import {
  startSlideJobAction,
  updateSlideJobAction,
  finishSlideJobAction,
} from "@/lib/actions/slide-jobs";
import { updateSlideStatusAction } from "@/lib/actions/slide";
import {
  useSlideGenerationStore,
  type SlideGenerationStatus,
} from "@/lib/stores/useSlideGenerationStore";
import {
  SlideGenerationQueue,
  type SlideGenerationSummary,
} from "@/lib/infrastructure/queue/SlideGenerationQueue";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/components/LocaleProvider";

/**
 * True when running inside the Tauri desktop shell. Mirrors the check in
 * components/export-modal.tsx so PPT export can use the native save dialog.
 */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

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
  const t = useTranslations();
  const locale = useLocale();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const router = useRouter();
  const { toast } = useToast();
  const [slides, setSlides] = useState(initialSlides);
  // v0.12.0 (RB4.1) — re-sync local `slides` state whenever the server sends
  // fresh data (after router.refresh() following a generation). A useState
  // initializer only runs on mount, so without this the thumbnails/htmlDesign
  // never repaint after generating a design — the root cause of "the design
  // doesn't update in the slides overview". We sync by identity of initialSlides
  // (a new array each server render) and adopt the server as authoritative for
  // htmlDesign/hasContent/hasHtml while leaving live batch markers to the store.
  useEffect(() => {
    setSlides(initialSlides);
    // Re-seed the "fully generated" set from the fresh server truth so a slide
    // that just gained its htmlDesign is reflected without a hard reload.
    setGeneratedIds((prev) => {
      const next = new Set(prev);
      for (const s of initialSlides) {
        if (isSlideFullyGenerated(s)) next.add(s.id);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSlides]);
  // v1.10 / Wave 2 — the parallel batch is owned by
  // `useSlideGenerationStore`. The component still tracks
  // `generatingId` for the single-slide "Generar" click (which
  // goes through the legacy slideAdapter path and shows a
  // spinner on the affected card while the LLM call is in
  // flight), and `generatedIds` / `failedIds` for the same
  // single-slide flow. The batch path uses the store directly.
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  // v0.11.0 — seed "generated" only with FULLY generated slides (content +
  // html for concept slides), not merely content-bearing ones. A content-only
  // slide must not appear as generated.
  const [generatedIds, setGeneratedIds] = useState<Set<string>>(
    new Set(initialSlides.filter(isSlideFullyGenerated).map((s) => s.id))
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
  const [exportingPpt, setExportingPpt] = useState(false);
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
  // v0.11.0 — id of the current ProcessingJob row backing the active batch, so
  // slide generation is visible in the Jobs tab. Null when no batch is running.
  const slideJobIdRef = useRef<string | null>(null);
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
        onSlideStatusChange: (slideId, status) => {
          void updateSlideStatusAction(slideId, status);
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

  // v0.12.0 (RC3) — hydrate store from DB status on mount so markers survive navigation
  useEffect(() => {
    const store = useSlideGenerationStore.getState();
    for (const slide of initialSlides) {
      if (slide.status && slide.status !== "idle") {
        // Directly seed the store with the persisted status, bypassing startGeneration
        // to avoid a "pending" → real-status flash.
        store.updateJob(slide.id, { status: slide.status as SlideGenerationStatus });
      }
    }
  }, [initialSlides]);

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


  // v0.11.0 — mirror batch progress into the ProcessingJob row so the Jobs tab
  // shows a live "Diapositiva N/Total" while the client-side queue runs.
  const processedCount = completedCount + failedCount;
  useEffect(() => {
    const jobId = slideJobIdRef.current;
    if (!jobId || totalCount === 0) return;
    void updateSlideJobAction(
      jobId,
      processedCount,
      `Diapositiva ${processedCount}/${totalCount}`
    );
  }, [processedCount, totalCount]);

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

  /**
   * Preflight before any generation: fail FAST and LOUD if no OpenRouter API
   * key is configured. Without this, the queue would fire N×2 LLM calls that
   * each 401 and burn through 3 retries before failing silently. Returns true
   * when it's safe to proceed.
   */
  const ensureApiKey = useCallback(async (): Promise<boolean> => {
    try {
      const settings = await getSettingsAction();
      if (!settings.apiKeyPresent) {
        toast({
          title: t("slides.apiKeyMissing"),
          description: t("slides.apiKeyHint"),
          variant: "error",
        });
        return false;
      }
      return true;
    } catch {
      // If the settings check itself fails, don't block — let the batch run and
      // surface any real error through the normal path.
      return true;
    }
  }, [toast, t]);

  // v0.11.0 — single-slide "Generar" now produces BOTH content and HTML
  // design (coherent with "Generar todo"), and opens a ProcessingJob so it is
  // visible in the Jobs tab. It reuses the same queue as the batch path so the
  // retry/phase semantics are identical.
  const handleGenerateSingle = useCallback(
    async (slideId: string) => {
      if (!queueRef.current) return;
      if (!(await ensureApiKey())) return;
      setGeneratingId(slideId);
      try {
        const { jobId } = await startSlideJobAction(
          courseId,
          1,
          "Generando diapositiva (contenido + HTML)"
        ).catch(() => ({ jobId: null as string | null }));

        await slideAdapter.generateSlideContent(slideId);
        await slideAdapter.regenerateHtmlDesign(slideId, "");
        setGeneratedIds((prev) => new Set(prev).add(slideId));
        setFailedIds((prev) => {
          const next = new Set(prev);
          next.delete(slideId);
          return next;
        });
        if (jobId) {
          void finishSlideJobAction(jobId, "completed", 1);
        }
        toast({
          title: t("slides.slideGenerated"),
          description: t("slides.slideGeneratedDescription"),
          variant: "success",
        });
        await revalidateSlides(courseId);
        router.refresh();
      } catch (err) {
        console.error("[slides] single slide generation failed:", err);
        setFailedIds((prev) => new Set(prev).add(slideId));
        toast({
          title: t("slides.generateError"),
            description: t("slides.slideGenerateFailed"),
          variant: "error",
        });
      } finally {
        setGeneratingId(null);
      }
    },
    [toast, courseId, slideAdapter, ensureApiKey, router, t]
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
          title: t("slides.generationCancelled"),
          description: t("slides.cancelledCount", { succeeded: number(succeeded), total: number(total) }),
          variant: "info",
        });
      } else if (failed === 0) {
        toast({
          title: t("slides.generationCompleted"),
          description: t("slides.completedCount", { succeeded: number(succeeded), total: number(total) }),
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
          title: t(failed === 1 ? "slides.completedOneError" : "slides.completedManyErrors", { failed: number(failed) }),
          description: t("slides.completedWithErrors", { succeeded: number(succeeded), failed: number(failed) }),
          variant: "info",
        });
      }
      // v0.11.0 — close the ProcessingJob row so the Jobs tab reflects the
      // terminal state (completed, or failed when any slide errored).
      const jobId = slideJobIdRef.current;
      if (jobId) {
        void finishSlideJobAction(
          jobId,
          failed > 0 ? "failed" : "completed",
          total,
          failed > 0 ? `${failed} diapositiva(s) con error` : undefined
        );
        slideJobIdRef.current = null;
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
    [courseId, router, toast, t, locale]
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
    if (!(await ensureApiKey())) return;
    toast({
      title: t(allIds.length === 1 ? "slides.generatingContentOne" : "slides.generatingContentMany", { count: number(allIds.length) }),
      description: t("slides.parallelContentHint"),
    });
    // v0.11.0 — open a ProcessingJob so the batch shows in the Jobs tab.
    try {
      const { jobId } = await startSlideJobAction(
        courseId,
        allIds.length,
        "Generando contenido de diapositivas"
      );
      slideJobIdRef.current = jobId;
    } catch {
      slideJobIdRef.current = null;
    }
    try {
      await queueRef.current.enqueueAll(allIds, { phases: ["content"] });
    } catch (err) {
      console.error("[slides] content batch failed:", err);
      toast({
        title: t("slides.batchError"),
        description: t("slides.batchStartFailed"),
        variant: "error",
      });
    }
  }, [slides, toast, ensureApiKey, courseId, t, locale]);

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
    if (!(await ensureApiKey())) return;
    toast({
      title: t(allIds.length === 1 ? "slides.generatingOne" : "slides.generatingMany", { count: number(allIds.length) }),
      description: t("slides.parallelAllHint"),
    });
    // v0.11.0 — open a ProcessingJob so the batch shows in the Jobs tab.
    try {
      const { jobId } = await startSlideJobAction(
        courseId,
        allIds.length,
        "Generando diapositivas (contenido + HTML)"
      );
      slideJobIdRef.current = jobId;
    } catch {
      slideJobIdRef.current = null;
    }
    try {
      await queueRef.current.enqueueAll(allIds, {
        phases: ["content", "html"],
      });
    } catch (err) {
      console.error("[slides] full batch failed:", err);
      toast({
        title: t("slides.batchError"),
        description: t("slides.batchStartFailed"),
        variant: "error",
      });
    }
  }, [slides, toast, ensureApiKey, courseId, t, locale]);

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
      toast({ title: t("slides.updated"), variant: "success" });
    } catch {
      toast({
        title: t("common.error"),
        description: t("slides.updateFailed"),
        variant: "error",
      });
    } finally {
      setSavingEdit(false);
    }
  }, [editingSlide, editTitle, editDesc, toast, slideAdapter, t]);

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
        toast({ title: t("slides.deleted"), variant: "success" });
      } catch {
        toast({
          title: t("common.error"),
          description: t("slides.deleteFailed"),
          variant: "error",
        });
      } finally {
        setDeletingId(null);
      }
    },
    [toast, slideAdapter, t]
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
      toast({ title: t("slides.added"), variant: "success" });
    } catch {
      toast({
        title: t("common.error"),
        description: t("slides.addFailed"),
        variant: "error",
      });
    } finally {
      setAdding(false);
    }
  }, [courseId, newTitle, newDesc, toast, slideAdapter, t]);

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
                title: t("export.printOpened"),
                description: t("export.printPdfHint"),
                variant: "info",
              });
            } catch {
              toast({
                title: t("export.printError"),
                description: t("export.printHtmlHint"),
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
            title: t("export.pdfError"),
            description: t("export.printPrepareFailed"),
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
        toast({ title: t("export.pdfExported"), variant: "success" });
      }
    } catch (err) {
      console.error("[slides] PDF export failed:", err);
      toast({
        title: t("export.pdfError"),
        description: t("common.unknownError"),
        variant: "error",
      });
    } finally {
      setExportingPdf(false);
    }
  }, [courseId, toast, t]);

  // Export PPT: calls the server action which renders each slide as a PNG
  // image via Playwright and assembles them into a .pptx (base64). On desktop
  // (Tauri) we open a native "Save as" dialog and write the BINARY via the
  // base64-decoding Rust command so the user chooses the location and the file
  // is not corrupted. On web we fall back to a blob download.
  const handleExportPpt = useCallback(async () => {
    setExportingPpt(true);
    try {
      console.log("[PPT Export] Starting export for courseId:", courseId);
      const result = await exportAllSlidesPptAction(courseId);
      console.log("[PPT Export] Server action returned:", { filename: result.filename, pptxLength: result.pptx.length });

      if (isTauri()) {
        console.log("[PPT Export] Running in Tauri, opening native save dialog");
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { invoke } = await import("@tauri-apps/api/core");
        const path = await save({
          filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
          defaultPath: result.filename,
        });
        if (!path) {
          console.log("[PPT Export] User cancelled save dialog");
          // User cancelled the save dialog — no-op, no error toast.
          return;
        }
        console.log("[PPT Export] User selected path:", path);
        // save_file_base64 decodes base64 → bytes on the Rust side so the
        // binary .pptx lands intact (plain save_file would corrupt it).
        await invoke("save_file_base64", { path, data: result.pptx });
        console.log("[PPT Export] File saved successfully");
        toast({ title: t("export.pptSaved"), description: t("export.presentationSaved"), variant: "success" });
        return;
      }

      // Web fallback: download the base64 PPTX via a blob + anchor click.
      const binary = atob(result.pptx);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: t("export.pptExported"),
        description: t("export.pptDownloaded"),
        variant: "success",
      });
    } catch (err) {
      console.error("[slides] PowerPoint export failed:", err);
      toast({
        title: t("export.pptError"),
        description: t("common.unknownError"),
        variant: "error",
      });
    } finally {
      setExportingPpt(false);
    }
  }, [courseId, toast, t]);

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
            {t("slides.heading")}
          </h1>
        </div>

        <EmptyState
          icon={<Layers className="h-10 w-10" />}
          title={t("slides.empty")}
          description={t("slides.emptyHint")}
          action={
            <Link
              href={`/courses/${courseId}/tree`}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <GitBranch className="h-4 w-4" />
              {t("slides.goToTree")}
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
            {t("slides.heading")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(slides.length === 1 ? "slides.countOne" : "slides.countMany", { count: number(slides.length) })} ·{" "}
            {t("slides.withContent", { count: number(generatedIds.size) })}
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
      {/* v0.12.0 (RB1.1) — the yellow in-page batch progress banner was
          removed. All generation progress is now communicated centrally in the
          Jobs tab (single source of truth), sourced from the slide-generation
          ProcessingJob row. The bottom control bar keeps a minimal inline
          "Cancelar" while running (RB1.2). */}

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
              {t("slides.progress", { completed: number(completedCount + failedCount), total: number(totalCount) })}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleCancelBatch}>
              {t("common.cancel")}
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
              aria-label={t("slides.generateAllContent")}
              title={t("slides.generateAllContentHint")}
            >
              <FileText className="h-4 w-4" />
              {t("slides.generateAllContent")}
            </Button>
            <Button
              onClick={handleGenerateAllWithHtml}
              size="sm"
              data-testid="generate-all-with-html"
              aria-label={t("slides.generateAllAccessible")}
              title={t("slides.generateAllHint")}
            >
              <Sparkles className="h-4 w-4" />
              {t("slides.generateAll")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddSlideOpen(true)}
            >
              <Plus className="h-4 w-4" />
              {t("slides.addSlide")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportOpen(true)}
            >
              <FileDown className="h-4 w-4" />
              {t("common.export")}
            </Button>
            {/* v1.5 / Task 4.3 — Direct one-click PPT export
                (one slide per PPT slide, rendered as PNG). */}
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPpt}
              loading={exportingPpt}
              data-testid="export-ppt-all"
              aria-label={t("export.pptAll")}
              title={t("export.pptAllHint")}
            >
              <Download className="h-4 w-4" />
              {t("export.ppt")}
            </Button>
          </>
        )}
      </div>

      {/* Add Slide Dialog */}
      <Dialog open={addSlideOpen} onClose={() => setAddSlideOpen(false)}>
        <DialogHeader>
          <DialogTitle>{t("slides.addSlide")}</DialogTitle>
          <DialogDescription>
            {t("slides.addSlideHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <Input
            id="new-slide-title"
            label={t("common.title")}
            placeholder={t("slides.titlePlaceholder")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <div className="space-y-1.5">
            <label
              htmlFor="new-slide-desc"
              className="block text-sm font-medium text-foreground"
            >
              {t("common.description")}
            </label>
            <Textarea
              id="new-slide-desc"
              placeholder={t("slides.optionalDescriptionPlaceholder")}
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
            {t("common.cancel")}
          </Button>
          <Button onClick={handleAddSlide} loading={adding} disabled={!newTitle.trim()}>
            {t("common.add")}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Edit Slide Dialog */}
      <Dialog open={editSlideOpen} onClose={() => setEditSlideOpen(false)}>
        <DialogHeader>
          <DialogTitle>{t("slides.editSlide")}</DialogTitle>
          <DialogDescription>
            {t("slides.editSlideHint")}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <Input
            id="edit-slide-title"
            label={t("common.title")}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <div className="space-y-1.5">
            <label
              htmlFor="edit-slide-desc"
              className="block text-sm font-medium text-foreground"
            >
              {t("common.description")}
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
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSaveEdit} loading={savingEdit} disabled={!editTitle.trim()}>
            <Save className="h-3.5 w-3.5" />
            {t("common.save")}
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

export { SlidesClient };
export type { SlidesClientProps };

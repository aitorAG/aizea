"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  Save,
  Edit,
  Eye,
  RefreshCw,
  FileCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { MarkdownKatex } from "@/components/markdown-katex";
import { useToast } from "@/components/toast";
import { updateBox } from "@/lib/actions/box";
import { updateSlide } from "@/lib/actions/slide";
import { exportSlideHtmlAction } from "@/lib/actions/slide-export";
import { buildIframeSlideHtml } from "@/lib/actions/slide-export-helpers";
import { revalidateSlide } from "@/lib/actions/revalidate";
import { useSlideAdapter } from "@/lib/adapters/useSlideAdapter";
import { BoxType } from "@/lib/types";
import { SlideNavigator, type SlideNavItem } from "@/components/slides/SlideNavigator";
import { SlideTitleField } from "@/components/slides/SlideTitleField";

const boxConfig: Record<BoxType, { icon: string; label: string }> = {
  [BoxType.SCRIPT]: { icon: "🎯", label: "Guion" },
  [BoxType.RELEVANCE]: { icon: "💡", label: "Relevancia" },
  [BoxType.NARRATIVE]: { icon: "📖", label: "Narrativa" },
  [BoxType.EXERCISE_1]: { icon: "✏️", label: "Ejercicio 1" },
  [BoxType.EXERCISE_2]: { icon: "✏️", label: "Ejercicio 2" },
};

const boxOrder: BoxType[] = [
  BoxType.SCRIPT,
  BoxType.RELEVANCE,
  BoxType.NARRATIVE,
  BoxType.EXERCISE_1,
  BoxType.EXERCISE_2,
];

interface SlideDetailClientProps {
  courseId: string;
  courseName: string;
  slideId: string;
  slideTitle: string;
  slideDescription: string;
  slideOrder: number;
  htmlDesign: string | null;
  boxIds: Record<string, string | null>;
  boxContents: Record<string, string>;
  /** F5.2: ordered list of sibling slides for the navigator. */
  siblingSlides: SlideNavItem[];
}

function SlideDetailClient({
  courseId,
  courseName,
  slideId,
  slideTitle,
  slideDescription,
  slideOrder,
  htmlDesign: initialHtmlDesign,
  boxIds: initialBoxIds,
  boxContents: initialContents,
  siblingSlides,
}: SlideDetailClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [boxes, setBoxes] = useState(initialContents);
  const [boxIds] = useState(initialBoxIds);
  const [htmlDesign, setHtmlDesign] = useState(initialHtmlDesign);
  const [designInstructions, setDesignInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [regeneratingHtml, setRegeneratingHtml] = useState(false);
  const [saving, setSaving] = useState(false);
  // F5.2: title/description editable — local state mirrors the server
  // until the user saves; we keep the latest value as state so the
  // SlideTitleField can render it without us having to re-fetch.
  const [title, setTitle] = useState(slideTitle);
  const [description, setDescription] = useState(slideDescription);
  const [savingTitle, setSavingTitle] = useState(false);
  const [editingBox, setEditingBox] = useState<BoxType | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(initialContents);
  const [exportingHtml, setExportingHtml] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const modalIframeRef = useRef<HTMLIFrameElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const [previewFull, setPreviewFull] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [modalScale, setModalScale] = useState(1);
  const slideAdapter = useSlideAdapter(courseId);

  // Re-sync local title state when the route changes to a different
  // slide (the page is re-rendered with new props). Without this,
  // navigating via Anterior/Siguiente would leave the heading stuck
  // on the previous slide's title until the page refreshed.
  useEffect(() => {
    setTitle(slideTitle);
    setDescription(slideDescription);
  }, [slideId, slideTitle, slideDescription]);

  // F5.2: jump to a sibling slide. We use router.push (not
  // router.replace) so the browser back button takes the user to the
  // previous slide — they expect that.
  const handleNavigate = useCallback(
    (targetSlideId: string) => {
      if (targetSlideId === slideId) return;
      router.push(`/courses/${courseId}/slides/${targetSlideId}`);
    },
    [router, courseId, slideId]
  );

  // F5.2: persist the edited title/description. We update local
  // state immediately for a snappy UI, then call the server action
  // and revalidate the slide route so the next navigation shows the
  // fresh value.
  const handleSaveTitle = useCallback(
    async (values: { title: string; description: string }) => {
      setSavingTitle(true);
      // Optimistic local update so the user sees the change instantly
      // even before the network round-trip completes.
      setTitle(values.title);
      setDescription(values.description);
      try {
        await updateSlide(slideId, {
          title: values.title,
          description: values.description,
        });
        await revalidateSlide(courseId, slideId);
        toast({
          title: "Título guardado",
          description: "Los cambios se han guardado correctamente.",
          variant: "success",
        });
      } catch (err) {
        // Roll back the optimistic update on failure.
        setTitle(slideTitle);
        setDescription(slideDescription);
        toast({
          title: "Error al guardar",
          description:
            err instanceof Error
              ? err.message
              : "No se pudo guardar el título.",
          variant: "error",
        });
        throw err;
      } finally {
        setSavingTitle(false);
      }
    },
    [courseId, slideId, slideTitle, slideDescription, toast]
  );

  // F1.5: build a UTF-8-safe HTML document for the iframe preview.
  // Using `srcdoc` (instead of `doc.write`) guarantees the iframe
  // document is parsed from scratch with `<meta charset="utf-8">`
  // as the very first element of `<head>`, so accented characters
  // and special symbols (á é í ó ú ñ — € @ ß) render correctly even
  // when the parent page is in a different encoding. We memoize the
  // wrapped HTML so we only rebuild it when `htmlDesign` actually
  // changes.
  const iframeSrcdoc = useMemo(() => {
    if (!htmlDesign) return "";
    return buildIframeSlideHtml({ htmlDesign });
  }, [htmlDesign]);

  useEffect(() => {
    const handleResize = (
      entries: ResizeObserverEntry[],
      setter: (s: number) => void
    ) => {
      for (const entry of entries) {
        // F1.3: scale considers BOTH width and height so the slide fits
        // entirely inside the container without overflow. The 0.95 factor
        // leaves a small visual margin (the slide is "pequeñito" inside
        // the frame rather than flush against the edges).
        const { width, height } = entry.contentRect;
        const scale = Math.min(width / 1280, height / 720) * 0.95;
        setter(scale);
      }
    };

    const previewObserver = new ResizeObserver((entries) =>
      handleResize(entries, setPreviewScale)
    );
    const modalObserver = new ResizeObserver((entries) =>
      handleResize(entries, setModalScale)
    );

    const previewEl = previewContainerRef.current;
    const modalEl = modalContainerRef.current;

    if (previewEl) previewObserver.observe(previewEl);
    if (modalEl) modalObserver.observe(modalEl);

    return () => {
      previewObserver.disconnect();
      modalObserver.disconnect();
    };
  }, [previewFull]);

  const handleGenerateContent = useCallback(async () => {
    setGenerating(true);
    try {
      const result = await slideAdapter.generateSlideContent(slideId);
      setBoxes({
        [BoxType.SCRIPT]: result.script ?? "",
        [BoxType.RELEVANCE]: result.relevance ?? "",
        [BoxType.NARRATIVE]: result.narrative ?? "",
        [BoxType.EXERCISE_1]: result.exercise1 ?? "",
        [BoxType.EXERCISE_2]: result.exercise2 ?? "",
      });
      setDrafts({
        [BoxType.SCRIPT]: result.script ?? "",
        [BoxType.RELEVANCE]: result.relevance ?? "",
        [BoxType.NARRATIVE]: result.narrative ?? "",
        [BoxType.EXERCISE_1]: result.exercise1 ?? "",
        [BoxType.EXERCISE_2]: result.exercise2 ?? "",
      });
      toast({
        title: "Contenido generado",
        description: "Se ha generado el contenido con IA.",
        variant: "success",
      });
      await revalidateSlide(courseId, slideId);
    } catch (err) {
      toast({
        title: "Error al generar",
        description:
          err instanceof Error ? err.message : "No se pudo generar el contenido.",
        variant: "error",
      });
    } finally {
      setGenerating(false);
    }
  }, [slideId, toast, courseId, slideAdapter]);

  const handleRegenerateHtml = useCallback(async () => {
    setRegeneratingHtml(true);
    try {
      const html = await slideAdapter.regenerateHtmlDesign(slideId, designInstructions);
      setHtmlDesign(html);
      toast({
        title: "HTML regenerado",
        description: "El diseño de la diapositiva se ha actualizado.",
        variant: "success",
      });
      await revalidateSlide(courseId, slideId);
    } catch (err) {
      toast({
        title: "Error al regenerar HTML",
        description:
          err instanceof Error ? err.message : "No se pudo regenerar el diseño.",
        variant: "error",
      });
    } finally {
      setRegeneratingHtml(false);
    }
  }, [slideId, designInstructions, toast, courseId, slideAdapter]);

  const handleOpenSlideInNewTab = useCallback(() => {
    if (!htmlDesign) return;
    // Wrap the raw fragment in a full document so KaTeX + UTF-8 + the
    // 1280x720 frame are present — without this, opening a slide with
    // LaTeX in a new tab would show raw `$..$` instead of rendered math.
    // The Blob type also explicitly declares `charset=utf-8` so the
    // browser parses the document as UTF-8 (F1.5: accents/€/@/ß).
    const wrapped = buildIframeSlideHtml({ htmlDesign });
    const blob = new Blob([wrapped], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [htmlDesign]);

  // F5.6: download a single slide as a self-contained .html file.
  // The server action wraps the slide's `htmlDesign` in a complete
  // document; we then trigger a browser download from the response.
  const handleExportHtml = useCallback(async () => {
    if (exportingHtml) return;
    setExportingHtml(true);
    try {
      const { html, filename } = await exportSlideHtmlAction(slideId);
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({
        title: "HTML exportado",
        description: `Se ha descargado ${filename}`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Error al exportar HTML",
        description:
          err instanceof Error
            ? err.message
            : "No se pudo exportar la diapositiva.",
        variant: "error",
      });
    } finally {
      setExportingHtml(false);
    }
  }, [slideId, exportingHtml, toast]);

  const handleSaveAll = useCallback(async () => {
    setSaving(true);
    try {
      // Save all box contents that have box IDs
      const savePromises: Promise<unknown>[] = [];
      for (const type of boxOrder) {
        const boxId = boxIds[type];
        if (boxId && drafts[type] !== boxes[type]) {
          savePromises.push(updateBox(boxId, drafts[type]));
        }
      }
      await Promise.all(savePromises);
      setBoxes(drafts);
      toast({
        title: "Cambios guardados",
        description: "Todo el contenido se ha guardado correctamente.",
        variant: "success",
      });
    } catch {
      toast({
        title: "Error al guardar",
        description: "No se pudieron guardar los cambios.",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }, [boxIds, drafts, boxes, toast]);

  const handleEditBox = useCallback((type: BoxType) => {
    setDrafts((prev) => ({ ...prev, [type]: boxes[type] }));
    setEditingBox(type);
  }, [boxes]);

  const handleCancelEdit = useCallback((type: BoxType) => {
    setEditingBox((prev) => (prev === type ? null : prev));
  }, []);

  const handleSaveBox = useCallback(
    async (type: BoxType) => {
      const boxId = boxIds[type];
      if (boxId) {
        await updateBox(boxId, drafts[type]);
      }
      setBoxes((prev) => ({ ...prev, [type]: drafts[type] }));
      setEditingBox(null);
      toast({ title: "Contenido guardado", variant: "success" });
    },
    [boxIds, drafts, toast]
  );

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div>
        <Link
          href={`/courses/${courseId}/slides`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {courseName} / Gestión de Diapositivas
        </Link>
      </div>

      {/* F5.2: slide navigator — dropdown + Anterior / Siguiente. */}
      <SlideNavigator
        courseId={courseId}
        currentSlideId={slideId}
        slides={siblingSlides}
        onNavigate={handleNavigate}
      />

      {/* Top bar */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-2">
          <Badge variant="secondary" className="mt-1 text-xs">
            {slideOrder + 1}
          </Badge>
          <div className="min-w-0 flex-1">
            <SlideTitleField
              title={title}
              description={description}
              onSave={handleSaveTitle}
              saving={savingTitle}
            />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            onClick={handleGenerateContent}
            disabled={generating}
            variant="outline"
            size="sm"
          >
            {generating ? (
              <Spinner size="sm" className="mr-1" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generating ? "Generando..." : "Generar Contenido"}
          </Button>
          <Button onClick={handleSaveAll} disabled={saving} size="sm">
            {saving ? <Spinner size="sm" className="mr-1" /> : <Save className="h-4 w-4" />}
            Guardar
          </Button>
        </div>
      </div>

      {/* Single-column layout — v1.5: HTML preview arriba, contenidos abajo */}
      <div className="flex min-w-0 flex-col gap-4 overflow-hidden">
        {/* TOP BLOCK: HTML Preview + Design Instructions */}
        <div className="min-w-0 space-y-4 overflow-hidden">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <h2 className="text-sm font-semibold">Vista previa HTML</h2>
              {htmlDesign && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenSlideInNewTab}
                    title="Abrir en nueva pestaña"
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleExportHtml}
                    disabled={exportingHtml}
                    title="Exportar diapositiva a HTML"
                    data-testid="export-html-button"
                  >
                    {exportingHtml ? (
                      <Spinner size="sm" />
                    ) : (
                      <FileCode className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {htmlDesign ? (
                <div
                  ref={previewContainerRef}
                  // F1.3: fixed small frame — `max-w-[700px]` + `aspect-video`
                  // caps the slide at ~700×394 so it always reads as a
                  // "pequeñito" preview rather than a giant responsive
                  // element. `overflow-hidden` is required because the
                  // iframe is 1280×720 in the DOM and we clip it visually
                  // with the CSS transform.
                  className="relative mx-auto aspect-video w-full max-w-[700px] cursor-pointer overflow-hidden rounded-md border border-border bg-white hover:ring-2 hover:ring-ring"
                  onClick={() => setPreviewFull(true)}
                  data-testid="slide-preview-container"
                >
                  <iframe
                    ref={iframeRef}
                    srcDoc={iframeSrcdoc}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "1280px",
                      height: "720px",
                      transform: `scale(${previewScale})`,
                      transformOrigin: "top left",
                      border: "none",
                    }}
                    sandbox="allow-same-origin allow-scripts allow-popups"
                    title="Vista previa de la diapositiva"
                  />
                </div>
              ) : (
                <div
                  data-testid="generar-slide-empty"
                  className="flex aspect-video flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border bg-muted/30 p-6"
                >
                  <Sparkles className="h-8 w-8 text-muted-foreground/60" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      Esta diapositiva aún no tiene diseño HTML
                    </p>
                    <p
                      data-testid="generar-slide-helper"
                      className="mt-1 text-xs text-muted-foreground"
                    >
                      Genera el diseño HTML con IA a partir del contenido
                      y las instrucciones de diseño.
                    </p>
                  </div>
                  <Button
                    data-testid="generar-slide-button"
                    onClick={handleRegenerateHtml}
                    disabled={regeneratingHtml}
                    size="sm"
                    className="mt-1"
                  >
                    {regeneratingHtml ? (
                      <Spinner size="sm" className="mr-1" />
                    ) : (
                      <Sparkles className="mr-1 h-4 w-4" />
                    )}
                    {regeneratingHtml ? "Generando..." : "Generar slide"}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Design Instructions */}
          <Card>
            <CardHeader className="pb-3">
              <h2 className="text-sm font-semibold">Instrucciones de diseño</h2>
              <p className="text-xs text-muted-foreground">
                Describe cómo quieres el diseño HTML. Se enviará junto con todo el
                contenido a la IA.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={designInstructions}
                onChange={(e) => setDesignInstructions(e.target.value)}
                rows={4}
                placeholder="Ej: Usa dos columnas, con el título arriba. Incluye las fórmulas destacadas en tarjetas azules..."
              />
              <Button
                onClick={handleRegenerateHtml}
                disabled={regeneratingHtml}
                variant="outline"
                size="sm"
                className="w-full"
              >
                {regeneratingHtml ? (
                  <Spinner size="sm" className="mr-1" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {regeneratingHtml ? "Regenerando..." : "Regenerar HTML"}
              </Button>
            </CardContent>
          </Card>

          <Dialog
            open={previewFull}
            onClose={() => setPreviewFull(false)}
            className="max-w-[90vw] w-[90vw]"
          >
            <DialogHeader>
              <DialogTitle>Vista previa HTML</DialogTitle>
            </DialogHeader>
            <DialogContent className="mt-4">
              <div
                ref={modalContainerRef}
                // F1.3: fullscreen preview — `aspect-video` keeps the
                // 16:9 frame and the same `min(W,H)*0.95` scale rule
                // (applied in the ResizeObserver above) guarantees the
                // 1280×720 slide never overflows the dialog.
                className="relative mx-auto aspect-video w-full overflow-hidden rounded-md border border-border bg-white"
                data-testid="slide-modal-container"
              >
                <iframe
                  ref={modalIframeRef}
                  srcDoc={iframeSrcdoc}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "1280px",
                    height: "720px",
                    transform: `scale(${modalScale})`,
                    transformOrigin: "top left",
                    border: "none",
                  }}
                  sandbox="allow-same-origin allow-scripts allow-popups"
                  title="Vista previa de la diapositiva"
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* BOTTOM BLOCK: Editable fields (boxes) */}
        <div className="space-y-3">
          {boxOrder.map((type) => {
            const config = boxConfig[type];
            const isEditing = editingBox === type;
            return (
              <Card key={type}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
                  <h3 className="text-sm font-semibold leading-none">
                    <span className="mr-1.5">{config.icon}</span>
                    {config.label}
                  </h3>
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      onClick={() => handleEditBox(type)}
                    >
                      <Edit className="h-3 w-3" />
                      Editar
                    </Button>
                  )}
                </CardHeader>
                <CardContent>
                  {isEditing ? (
                    <div className="space-y-3">
                      <Textarea
                        value={drafts[type] ?? ""}
                        onChange={(e) =>
                          setDrafts((prev) => ({ ...prev, [type]: e.target.value }))
                        }
                        rows={6}
                        className="font-mono text-sm"
                        autoFocus
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancelEdit(type)}
                        >
                          Cancelar
                        </Button>
                        <Button size="sm" onClick={() => handleSaveBox(type)}>
                          <Save className="h-3.5 w-3.5" />
                          Guardar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-border/50 bg-muted/20 p-3">
                      {boxes[type] ? (
                        <MarkdownKatex content={boxes[type]} />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Sin contenido. Genera o edita para añadir.
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { SlideDetailClient };
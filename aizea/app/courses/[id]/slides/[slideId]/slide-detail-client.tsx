"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
  Save,
  Edit,
  Eye,
  RefreshCw,
  FileText,
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
import { revalidateSlide } from "@/lib/actions/revalidate";
import { useSlideAdapter } from "@/lib/adapters/useSlideAdapter";
import { BoxType } from "@/lib/types";

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
}: SlideDetailClientProps) {
  const { toast } = useToast();
  const [boxes, setBoxes] = useState(initialContents);
  const [boxIds] = useState(initialBoxIds);
  const [htmlDesign, setHtmlDesign] = useState(initialHtmlDesign);
  const [designInstructions, setDesignInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [regeneratingHtml, setRegeneratingHtml] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingBox, setEditingBox] = useState<BoxType | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>(initialContents);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const modalIframeRef = useRef<HTMLIFrameElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const [previewFull, setPreviewFull] = useState(false);
  const [previewScale, setPreviewScale] = useState(1);
  const [modalScale, setModalScale] = useState(1);
  const slideAdapter = useSlideAdapter(courseId);

  // Render HTML into iframe(s)
  useEffect(() => {
    const writeToIframe = (iframe: HTMLIFrameElement | null) => {
      if (!iframe || !htmlDesign) return;
      const doc = iframe.contentDocument;
      if (!doc) return;
      doc.open();
      doc.write(htmlDesign);
      doc.close();
    };
    writeToIframe(iframeRef.current);
    writeToIframe(modalIframeRef.current);
  }, [htmlDesign, previewFull]);

  useEffect(() => {
    const handleResize = (
      entries: ResizeObserverEntry[],
      setter: (s: number) => void
    ) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        const scale = width / 1280;
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
    const blob = new Blob([htmlDesign], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [htmlDesign]);

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

      {/* Top bar */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {slideOrder + 1}
            </Badge>
            <h1 className="text-xl font-bold tracking-tight">{slideTitle}</h1>
          </div>
          {slideDescription && (
            <p className="mt-1 text-sm text-muted-foreground">
              {slideDescription}
            </p>
          )}
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

      {/* Two-column layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[55fr_45fr]">
        {/* LEFT COLUMN: HTML Preview + Design Instructions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <h2 className="text-sm font-semibold">Vista previa HTML</h2>
              {htmlDesign && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleOpenSlideInNewTab}
                >
                  <Eye className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {htmlDesign ? (
                <div
                  ref={previewContainerRef}
                  className="cursor-pointer overflow-hidden rounded-md border border-border bg-white hover:ring-2 hover:ring-ring"
                  onClick={() => setPreviewFull(true)}
                  style={{ height: 720 * previewScale }}
                >
                  <iframe
                    ref={iframeRef}
                    style={{
                      width: "1280px",
                      height: "720px",
                      transform: `scale(${previewScale})`,
                      transformOrigin: "top left",
                      border: "none",
                    }}
                    sandbox="allow-same-origin allow-scripts"
                    title="Vista previa de la diapositiva"
                  />
                </div>
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/30">
                  <FileText className="h-10 w-10 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    Sin diseño — genera el contenido primero
                  </p>
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
                className="overflow-hidden rounded-md border border-border bg-white"
                style={{ height: 720 * modalScale }}
              >
                <iframe
                  ref={modalIframeRef}
                  style={{
                    width: "1280px",
                    height: "720px",
                    transform: `scale(${modalScale})`,
                    transformOrigin: "top left",
                    border: "none",
                  }}
                  sandbox="allow-same-origin allow-scripts"
                  title="Vista previa de la diapositiva"
                />
              </div>
            </DialogContent>
          </Dialog>
        </div>

        {/* RIGHT COLUMN: Editable fields */}
        <div className="space-y-3 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
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
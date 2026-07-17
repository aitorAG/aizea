"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Image, FileDown, FileText, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SlideList } from "@/components/slide-list";
import { UploadZone } from "@/components/upload-zone";
import { ExportModal } from "@/components/export-modal";
import { useToast } from "@/components/toast";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { updateFigure } from "@/lib/actions/figure";
import { revalidateCourse } from "@/lib/actions/revalidate";
import { useCourseAdapter } from "@/lib/adapters/useCourseAdapter";
import { useSlideAdapter } from "@/lib/adapters/useSlideAdapter";
import type { SlideOutline } from "@/lib/types";

interface MaterialSummary {
  id: string;
  filename: string;
  pageCount: number;
  createdAt: string;
}

interface FigureSummary {
  id: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
  tags: string[];
}

interface CourseDetailClientProps {
  courseId: string;
  courseName: string;
  slides: SlideOutline[];
  materials: MaterialSummary[];
  figures: FigureSummary[];
}

function CourseDetailClient({
  courseId,
  courseName,
  slides: initialSlides,
  materials,
  figures,
}: CourseDetailClientProps) {
  const { toast } = useToast();
  const [slides, setSlides] = useState(initialSlides);
  const [exportOpen, setExportOpen] = useState(false);
  const [addSlideOpen, setAddSlideOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const courseAdapter = useCourseAdapter();
  const slideAdapter = useSlideAdapter(courseId);

  const handleReorder = useCallback(
    async (reordered: SlideOutline[]) => {
      setSlides(reordered);
      try {
        await slideAdapter.reorderSlides(
          reordered.map((s) => s.id)
        );
      } catch (err) {
        toast({ title: "Error al reordenar", description: "No se pudo guardar el nuevo orden.", variant: "error" });
        setSlides(initialSlides);
      }
    },
    [courseId, initialSlides, toast, slideAdapter]
  );

  const handleEditSlide = useCallback(
    async (id: string, title: string, description: string) => {
      await slideAdapter.updateSlide(id, { title, description });
      setSlides((prev) =>
        prev.map((s) => (s.id === id ? { ...s, title, description } : s))
      );
    },
    [slideAdapter]
  );

  const handleDeleteSlide = useCallback(
    async (id: string) => {
      await slideAdapter.deleteSlide(id);
      setSlides((prev) => prev.filter((s) => s.id !== id));
    },
    [slideAdapter]
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
          order: prev.length + 1,
        },
      ]);
      setAddSlideOpen(false);
      setNewTitle("");
      setNewDesc("");
      toast({ title: "Diapositiva añadida", variant: "success" });
    } catch (err) {
      toast({ title: "Error", description: "No se pudo añadir la diapositiva.", variant: "error" });
    } finally {
      setAdding(false);
    }
  }, [courseId, newTitle, newDesc, toast, slideAdapter]);

  const handleFigureUpdate = useCallback(
    async (id: string, data: { caption?: string; tags?: string[] }) => {
      await updateFigure(id, data);
      toast({ title: "Figura actualizada", variant: "success" });
    },
    [toast]
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver al inicio
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{courseName}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <FileDown className="h-4 w-4" />
            Exportar
          </Button>
        </div>
      </div>

      {/* Materials Section */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Materiales
        </h2>
        <UploadZone courseId={courseId} onUploadComplete={async () => await revalidateCourse(courseId)} />
        {materials.length > 0 && (
          <div className="mt-3 space-y-2">
            {materials.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-2.5"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium truncate">{m.filename}</span>
                  {m.pageCount > 0 && (
                    <Badge variant="secondary" className="text-[10px]">
                      {m.pageCount} págs.
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {new Date(m.createdAt).toLocaleDateString("es-ES")}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Slides Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Esquema de Diapositivas
          </h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddSlideOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Añadir Diapositiva
            </Button>
          </div>
        </div>

        {slides.length === 0 ? (
<EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="Sin diapositivas"
            description="Genera un esquema con IA o añade diapositivas manualmente."
          />
        ) : (
          <SlideList
            slides={slides}
            onReorder={handleReorder}
            onEditSlide={handleEditSlide}
            onDeleteSlide={handleDeleteSlide}
          />
        )}

        {slides.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Ir a diapositiva:</h3>
            <div className="flex flex-wrap gap-2">
              {slides.map((slide) => (
                <Link key={slide.id} href={`/courses/${courseId}/slides/${slide.id}`}>
                  <Badge variant="outline" className="cursor-pointer hover:bg-secondary transition-colors">
                    {slide.order}. {slide.title}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Figures Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Image className="h-5 w-5 text-primary" />
            Figuras
          </h2>
          <Link href={`/courses/${courseId}/figures`}>
            <Button variant="outline" size="sm">
              Ver galería
            </Button>
          </Link>
        </div>
        {figures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay figuras extraídas aún. Ve a la galería para extraerlas del PDF.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {figures.length} figura{figures.length !== 1 ? "s" : ""} disponible{figures.length !== 1 ? "s" : ""} en la galería.
          </p>
        )}
      </section>

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
          <Input
            id="new-slide-desc"
            label="Descripción"
            placeholder="Descripción breve (opcional)"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddSlideOpen(false)} disabled={adding}>
            Cancelar
          </Button>
          <Button onClick={handleAddSlide} loading={adding} disabled={!newTitle.trim()}>
            Añadir
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

export { CourseDetailClient };
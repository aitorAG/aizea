"use client";

import { useState, useCallback, useRef, memo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Sparkles,
  Plus,
  FileDown,
  Layers,
  GripVertical,
  Save,
  GitBranch,
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
import { SlideBlock } from "@/components/slide-block";
import { ExportModal } from "@/components/export-modal";
import { useToast } from "@/components/toast";
import { revalidateSlides } from "@/lib/actions/revalidate";
import { useSlideAdapter } from "@/lib/adapters/useSlideAdapter";

interface SlideSummary {
  id: string;
  title: string;
  description: string;
  order: number;
  htmlDesign?: string | null;
  hasContent: boolean;
}

interface SlidesClientProps {
  courseId: string;
  courseName: string;
  slides: SlideSummary[];
  materialCount: number;
}

const SortableSlide = memo(function SortableSlide({
  slide,
  totalSlides,
  isGenerating,
  isGenerated,
  onGenerate,
  onEdit,
  onDelete,
  onNavigate,
}: {
  slide: SlideSummary;
  totalSlides: number;
  isGenerating: boolean;
  isGenerated: boolean;
  onGenerate: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: slide.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-1">
      <button
        {...attributes}
        {...listeners}
        suppressHydrationWarning
        className="my-1 cursor-grab rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
        aria-label="Arrastrar para reordenar"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <SlideBlock
          slide={slide}
          totalSlides={totalSlides}
          isGenerating={isGenerating}
          isGenerated={isGenerated}
          onGenerate={onGenerate}
          onEdit={onEdit}
          onDelete={onDelete}
          onNavigate={onNavigate}
        />
      </div>
    </div>
  );
});

function SlidesClient({
  courseId,
  courseName,
  slides: initialSlides,
  materialCount,
}: SlidesClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [slides, setSlides] = useState(initialSlides);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [batchGenerating, setBatchGenerating] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [generatedIds, setGeneratedIds] = useState<Set<string>>(
    new Set(initialSlides.filter((s) => s.hasContent).map((s) => s.id))
  );
  const [exportOpen, setExportOpen] = useState(false);
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
  const batchCancelled = useRef(false);
  const slideAdapter = useSlideAdapter(courseId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
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

  const handleGenerateAll = useCallback(async () => {
    batchCancelled.current = false;
    setBatchGenerating(true);
    setBatchProgress(0);

    let completed = 0;
    for (const slide of slides) {
      if (batchCancelled.current) break;

      setGeneratingId(slide.id);
      try {
        await slideAdapter.generateSlideContent(slide.id);
        setGeneratedIds((prev) => new Set(prev).add(slide.id));
      } catch {
        // Continue with next slide even if one fails
      }
      completed++;
      setBatchProgress(completed);
    }

    setGeneratingId(null);
    setBatchGenerating(false);
    if (!batchCancelled.current) {
      toast({
        title: "Generación completada",
        description: `${completed} de ${slides.length} diapositivas procesadas.`,
        variant: "success",
      });
      await revalidateSlides(courseId);
    }
  }, [slides, toast, courseId, slideAdapter]);

  const handleCancelBatch = useCallback(() => {
    batchCancelled.current = true;
    setBatchGenerating(false);
    setGeneratingId(null);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = slides.findIndex((s) => s.id === active.id);
      const newIndex = slides.findIndex((s) => s.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = [...slides];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);
      const updated = reordered.map((s, i) => ({ ...s, order: i }));

      setSlides(updated);
      try {
        await slideAdapter.reorderSlides(
          updated.map((s) => s.id)
        );
      } catch {
        toast({
          title: "Error al reordenar",
          description: "No se pudo guardar el nuevo orden.",
          variant: "error",
        });
        setSlides(initialSlides);
      }
    },
    [slides, courseId, initialSlides, toast, slideAdapter]
  );

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

      {/* Slide list with drag & drop */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={slides.map((s) => s.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="space-y-2">
            {slides.map((slide) => (
              <SortableSlide
                key={slide.id}
                slide={slide}
                totalSlides={slides.length}
                isGenerating={generatingId === slide.id}
                isGenerated={generatedIds.has(slide.id) || slide.hasContent}
                onGenerate={handleGenerateSingle}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Bottom controls */}
      <div className="sticky bottom-4 z-30 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
        {batchGenerating ? (
          <>
            <Badge variant="info" className="gap-1.5">
              <Spinner size="sm" className="h-3 w-3" />
              Generando {batchProgress} / {slides.length}
            </Badge>
            <Button variant="outline" size="sm" onClick={handleCancelBatch}>
              Cancelar
            </Button>
          </>
        ) : (
          <>
            <Button onClick={handleGenerateAll} size="sm">
              <Sparkles className="h-4 w-4" />
              Generar Todo
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

export { SlidesClient };
export type { SlidesClientProps };
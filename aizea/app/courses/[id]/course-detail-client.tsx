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
import { useLocale, useTranslations } from "@/components/LocaleProvider";

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
  const t = useTranslations();
  const locale = useLocale();
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
        toast({ title: t("course.errors.reorder"), description: t("course.errors.reorderDescription"), variant: "error" });
        setSlides(initialSlides);
      }
    },
    [courseId, initialSlides, toast, slideAdapter, t]
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
       toast({ title: t("course.slides.added"), variant: "success" });
    } catch (err) {
       toast({ title: t("common.error"), description: t("course.errors.addSlide"), variant: "error" });
    } finally {
      setAdding(false);
    }
  }, [courseId, newTitle, newDesc, toast, slideAdapter, t]);

  const handleFigureUpdate = useCallback(
    async (id: string, data: { caption?: string; tags?: string[] }) => {
      await updateFigure(id, data);
       toast({ title: t("course.figures.updated"), variant: "success" });
    },
    [toast, t]
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
             {t("common.backHome")}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">{courseName}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <FileDown className="h-4 w-4" />
             {t("common.export")}
          </Button>
        </div>
      </div>

      {/* Materials Section */}
      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
           {t("course.materials.title")}
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
                       {t(m.pageCount === 1 ? "course.materials.pageOne" : "course.materials.pageMany", { count: m.pageCount })}
                    </Badge>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                   {new Date(m.createdAt).toLocaleDateString(locale)}
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
             {t("course.slides.outline")}
          </h2>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddSlideOpen(true)}
            >
              <Plus className="h-4 w-4" />
               {t("course.slides.add")}
            </Button>
          </div>
        </div>

        {slides.length === 0 ? (
<EmptyState
            icon={<Layers className="h-8 w-8" />}
             title={t("course.slides.emptyTitle")}
             description={t("course.slides.emptyDescription")}
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
             <h3 className="text-sm font-medium text-muted-foreground mb-2">{t("course.slides.goTo")}</h3>
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
             {t("course.figures.title")}
          </h2>
          <Link href={`/courses/${courseId}/figures`}>
            <Button variant="outline" size="sm">
               {t("course.figures.viewGallery")}
            </Button>
          </Link>
        </div>
        {figures.length === 0 ? (
          <p className="text-sm text-muted-foreground">
             {t("course.figures.empty")}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
             {t(figures.length === 1 ? "course.figures.availableOne" : "course.figures.availableMany", { count: figures.length })}
          </p>
        )}
      </section>

      {/* Add Slide Dialog */}
      <Dialog open={addSlideOpen} onClose={() => setAddSlideOpen(false)}>
        <DialogHeader>
           <DialogTitle>{t("course.slides.addTitle")}</DialogTitle>
          <DialogDescription>
             {t("course.slides.addDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <Input
            id="new-slide-title"
             label={t("common.title")}
             placeholder={t("course.slides.titlePlaceholder")}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <Input
            id="new-slide-desc"
             label={t("common.description")}
             placeholder={t("course.slides.descriptionPlaceholder")}
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setAddSlideOpen(false)} disabled={adding}>
             {t("common.cancel")}
          </Button>
          <Button onClick={handleAddSlide} loading={adding} disabled={!newTitle.trim()}>
             {t("common.add")}
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

"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Sparkles, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { FigureCard } from "@/components/figure-card";
import { useToast } from "@/components/toast";
import { extractFigureRefs, updateFigure } from "@/lib/actions/figure";
import { useTranslations } from "@/components/LocaleProvider";

interface FigureData {
  id: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
  tags: string[];
}

interface FigureGalleryClientProps {
  courseId: string;
  courseName: string;
  figures: FigureData[];
}

function FigureGalleryClient({ courseId, courseName, figures: initialFigures }: FigureGalleryClientProps) {
  const { toast } = useToast();
  const t = useTranslations();
  const [figures, setFigures] = useState(initialFigures);
  const [extracting, setExtracting] = useState(false);

  const handleExtract = useCallback(async () => {
    setExtracting(true);
    try {
      await extractFigureRefs(courseId);
       toast({ title: t("figures.extracted"), description: t("figures.extractedDescription"), variant: "success" });
      window.location.reload();
    } catch (err) {
      console.error("[figures] extraction failed:", err);
      toast({
         title: t("figures.errors.extract"),
         description: t("figures.errors.extractDescription"),
        variant: "error",
      });
    } finally {
      setExtracting(false);
    }
  }, [courseId, toast, t]);

  const handleUpdate = useCallback(
    async (id: string, data: { caption?: string; tags?: string[] }) => {
      await updateFigure(id, data);
      setFigures((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, caption: data.caption ?? f.caption, tags: data.tags ?? f.tags } : f
        )
      );
    },
    []
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href={`/courses/${courseId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
           {t("common.backToCourse")}
        </Link>
        <div className="flex items-start justify-between mt-2">
          <div>
             <h1 className="text-2xl font-bold tracking-tight">{t("figures.title")}</h1>
            <p className="text-sm text-muted-foreground">{courseName}</p>
          </div>
          <Button onClick={handleExtract} disabled={extracting}>
            {extracting ? (
              <Spinner size="sm" className="mr-1" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
             {extracting ? t("figures.extracting") : t("figures.extract")}
          </Button>
        </div>
      </div>

      {/* Figure Grid */}
      {figures.length === 0 ? (
        <EmptyState
          icon={<Image className="h-8 w-8" />}
           title={t("figures.emptyTitle")}
           description={t("figures.emptyDescription")}
          action={
            <Button onClick={handleExtract} disabled={extracting}>
              <Sparkles className="h-4 w-4" />
               {t("figures.extractShort")}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {figures.map((figure) => (
            <FigureCard
              key={figure.id}
              id={figure.id}
              filename={figure.filename}
              caption={figure.caption}
              pageNum={figure.pageNum}
              tags={figure.tags}
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { FigureGalleryClient };

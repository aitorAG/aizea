"use client";

import { useState, useEffect, useRef, memo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SlideThumbnail } from "@/components/slide-thumbnail";
import { Sparkles, Edit, Trash2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_STEPS = [
  "Conectando con la IA...",
  "Analizando material de referencia...",
  "Generando guion y narrativa...",
  "Creando diseño HTML...",
  "Finalizando...",
];

interface SlideBlockProps {
  slide: {
    id: string;
    title: string;
    description: string;
    order: number;
    htmlDesign?: string | null;
  };
  totalSlides: number;
  isGenerating: boolean;
  isGenerated: boolean;
  onGenerate: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onNavigate: (id: string) => void;
}

const SlideBlock = memo(function SlideBlock({
  slide,
  totalSlides,
  isGenerating,
  isGenerated,
  onGenerate,
  onEdit,
  onDelete,
  onNavigate,
}: SlideBlockProps) {
  const [statusStep, setStatusStep] = useState(0);
  const [showDone, setShowDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cycle through status steps during generation
  useEffect(() => {
    if (isGenerating) {
      setStatusStep(0);
      setShowDone(false);
      intervalRef.current = setInterval(() => {
        setStatusStep((prev) => (prev < STATUS_STEPS.length - 1 ? prev + 1 : prev));
      }, 4000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      // Show "done" flash briefly when generation completes
      if (isGenerated) {
        setShowDone(true);
        const timer = setTimeout(() => setShowDone(false), 3000);
        return () => clearTimeout(timer);
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isGenerating, isGenerated]);

  const borderColor = isGenerating
    ? "border-l-sky-500"
    : isGenerated
      ? "border-l-emerald-500"
      : "border-l-border";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onNavigate(slide.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onNavigate(slide.id);
      }}
      className={cn(
        "group flex items-stretch gap-4 border-l-4 p-4 transition-all duration-300 hover:shadow-md",
        borderColor,
        isGenerating && "bg-sky-50/30"
      )}
    >
      {/* Left: Thumbnail (30%) */}
      <div className="flex items-center">
        <SlideThumbnail
          html={slide.htmlDesign ?? null}
          slideNumber={slide.order + 1}
          onClick={() => onNavigate(slide.id)}
        />
      </div>

      {/* Right: Info + Actions (70%) */}
      <div className="flex min-w-0 flex-1 flex-col justify-between py-1">
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="shrink-0 text-[11px] font-semibold tabular-nums">
              {slide.order + 1} / {totalSlides}
            </Badge>

            {/* Status indicator */}
            {isGenerating && (
              <span className="flex items-center gap-1.5 text-xs text-sky-600 animate-in fade-in">
                <Spinner size="sm" className="h-3 w-3" />
                <span className="animate-pulse">{STATUS_STEPS[statusStep]}</span>
              </span>
            )}
            {showDone && (
              <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 animate-in fade-in slide-in-from-left-2">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Completado
              </span>
            )}
            {isGenerated && !isGenerating && !showDone && (
              <span className="text-xs font-medium text-emerald-600">Listo</span>
            )}
          </div>

          <h3 className="truncate text-sm font-semibold leading-tight">
            {slide.title}
          </h3>
          {slide.description && (
            <p className="line-clamp-2 text-xs text-muted-foreground">
              {slide.description}
            </p>
          )}
        </div>

        {/* Action icons */}
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1 pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onGenerate(slide.id);
              }}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Spinner size="sm" className="h-3.5 w-3.5" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">
                {isGenerated ? "Regenerar" : "Generar"}
              </span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={(e) => {
                e.stopPropagation();
                onEdit(slide.id);
              }}
              aria-label="Editar"
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(slide.id);
              }}
              aria-label="Eliminar"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
});

export { SlideBlock };
export type { SlideBlockProps };

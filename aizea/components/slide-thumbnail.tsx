"use client";

import { useEffect, useRef, memo } from "react";
import { FileText } from "lucide-react";

interface SlideThumbnailProps {
  html: string | null;
  slideNumber: number;
  onClick: () => void;
}

function SlideThumbnailImpl({ html, slideNumber, onClick }: SlideThumbnailProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(html);
    doc.close();
  }, [html]);

  if (!html) {
    return (
      <button
        onClick={onClick}
        className="flex h-[150px] w-[200px] shrink-0 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 transition-colors hover:border-primary/50 hover:bg-muted/60"
        aria-label={`Diapositiva ${slideNumber}`}
      >
        <FileText className="h-8 w-8 text-muted-foreground/60" />
        <span className="text-xs font-medium text-muted-foreground">
          Diapositiva {slideNumber}
        </span>
        <span className="text-[10px] text-muted-foreground/70">Sin diseño</span>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className="group/thumbnail relative h-[150px] w-[200px] shrink-0 overflow-hidden rounded-md border border-border bg-white transition-shadow hover:shadow-md"
      aria-label={`Ver diapositiva ${slideNumber}`}
    >
      <iframe
        ref={iframeRef}
        className="pointer-events-none"
        style={{
          width: "1280px",
          height: "720px",
          transform: "scale(0.15625)",
          transformOrigin: "top left",
          border: "none",
        }}
        sandbox="allow-same-origin"
        scrolling="no"
        title={`Vista previa diapositiva ${slideNumber}`}
      />
      <div className="absolute inset-0 bg-transparent transition-colors group-hover/thumbnail:bg-primary/5" />
    </button>
  );
}

export const SlideThumbnail = memo(SlideThumbnailImpl);
export type { SlideThumbnailProps };
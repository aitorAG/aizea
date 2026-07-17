"use client";

import { useEffect, useRef } from "react";
import katex from "katex";

interface KatexRendererProps {
  expression: string;
  displayMode?: boolean;
  className?: string;
}

function KatexRenderer({ expression, displayMode = false, className }: KatexRendererProps) {
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      katex.render(expression, containerRef.current, {
        displayMode,
        throwOnError: false,
        strict: false,
      });
    } catch {
      if (containerRef.current) {
        containerRef.current.textContent = expression;
      }
    }
  }, [expression, displayMode]);

  if (displayMode) {
    return (
      <div className={className}>
        <span ref={containerRef} className="katex-display-wrapper block overflow-x-auto py-2" />
      </div>
    );
  }

  return (
    <span ref={containerRef} className={className} />
  );
}

export { KatexRenderer };
export type { KatexRendererProps };
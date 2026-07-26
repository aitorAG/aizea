"use client";

// Next App Router route-level error boundary (Fase 4).
//
// Next renders this automatically when a Server or Client Component in the
// segment tree throws during render. It reuses the SAME fallback UI as the
// reusable `ErrorBoundary` so route-level and component-level errors look and
// behave identically. `reset()` re-renders the segment without a full reload.

import { useEffect } from "react";
import { DefaultErrorFallback } from "@/components/ErrorBoundary/ErrorBoundary";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <DefaultErrorFallback error={error} reset={reset} />
    </div>
  );
}

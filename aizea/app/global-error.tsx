"use client";

// Next App Router GLOBAL error boundary (Fase 4).
//
// This catches errors thrown in the root layout itself — the one place the
// segment-level `error.tsx` cannot cover. It MUST render its own <html>/<body>
// because it replaces the root layout when it activates.

import { DefaultErrorFallback } from "@/components/ErrorBoundary/ErrorBoundary";
import { LocaleProvider } from "@/components/LocaleProvider";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error] root error:", error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <LocaleProvider locale="es">
          <div className="flex min-h-screen items-center justify-center p-6">
            <DefaultErrorFallback error={error} reset={reset} />
          </div>
        </LocaleProvider>
      </body>
    </html>
  );
}

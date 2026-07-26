"use client";

// Next App Router GLOBAL error boundary (Fase 4).
//
// This catches errors thrown in the root layout itself — the one place the
// segment-level `error.tsx` cannot cover. It MUST render its own <html>/<body>
// because it replaces the root layout when it activates.

import { DefaultErrorFallback } from "@/components/ErrorBoundary/ErrorBoundary";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <div className="flex min-h-screen items-center justify-center p-6">
          <DefaultErrorFallback error={error} reset={reset} />
        </div>
      </body>
    </html>
  );
}

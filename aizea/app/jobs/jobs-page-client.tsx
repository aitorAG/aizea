"use client";

// JobsPageClient — the client-side body of the /jobs page. Wraps
// JobsPanelContent in the page-level chrome (header + back link).
// JobsPanelContent owns the data fetch + polling + row rendering
// + actions, so this component is just layout.

import Link from "next/link";
import { ArrowLeft, Activity, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JobsPanelContent } from "@/components/JobsPanelContent";
import { useJobsUIStore } from "@/lib/stores/useJobsUIStore";

export function JobsPageClient() {
  const setActiveCount = useJobsUIStore((s) => s.setActiveCount);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver al inicio
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
              <Activity className="h-5 w-5 text-primary" />
              Trabajos
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Estado de los pipelines y trabajos de generación en curso.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => useJobsUIStore.getState().open()}
            data-testid="jobs-page-open-sidebar"
          >
            <Inbox className="h-4 w-4" />
            Abrir panel lateral
          </Button>
        </div>
      </div>

      {/* Body — the panel renders inside a rounded card so the
          tabs and the rows feel like a unified surface. */}
      <div
        className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
        data-testid="jobs-page-card"
      >
        <div className="h-[60vh] min-h-[420px]">
          <JobsPanelContent
            variant="page"
            onActiveCountChange={setActiveCount}
          />
        </div>
      </div>
    </div>
  );
}

export default JobsPageClient;

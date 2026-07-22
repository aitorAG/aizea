"use client";

// JobsSidebar — v1.11 right-side drawer that hosts the global
// Jobs panel. Mounted once from `app/layout.tsx` so the same
// drawer is reachable from any page via the nav button.
//
// The drawer is opened by `useJobsUIStore.open()` (called from
// the nav button click handler) and closed by:
//
//   - clicking the X button in the header,
//   - pressing Escape,
//   - clicking the backdrop overlay,
//   - calling `useJobsUIStore.close()` programmatically.
//
// All close paths go through the store so any consumer (e.g. a
// future "go to job" link from a toast) can dismiss the drawer
// without re-implementing the handler.
//
// Z-index: z-50 matches the global <header> (sticky z-50). The
// drawer sits above the header, the pipeline banner (z-60), and
// the toast container (z-100). The drawer's z-50 keeps the panel
// in the same layer as the header so the header does not bleed
// through the slide animation — and because the panel is mounted
// to the right of the header, layering at the same z is fine.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { X, Maximize2, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { JobsPanelContent } from "@/components/JobsPanelContent";
import { useJobsUIStore } from "@/lib/stores/useJobsUIStore";

export function JobsSidebar() {
  const isOpen = useJobsUIStore((s) => s.isOpen);
  const close = useJobsUIStore((s) => s.close);
  const setActiveCount = useJobsUIStore((s) => s.setActiveCount);
  const panelRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const pathname = usePathname();

  // Body scroll lock when open — same pattern the Dialog uses.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Escape key closes. Bound only while open.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen) return null;

  // The "Open full page" button jumps the user to /jobs, but we
  // pre-close the drawer first so the click outside (backdrop)
  // handler doesn't fight the navigation.
  const openFullPage = () => {
    close();
    // Avoid pointless nav if the user is already on /jobs.
    if (pathname !== "/jobs") {
      router.push("/jobs");
    }
  };

  return (
    <div
      data-testid="jobs-sidebar-root"
      data-open={isOpen ? "true" : "false"}
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Panel de trabajos"
    >
      {/* Backdrop — clicking it closes the drawer. Pointer events
          are isolated to the backdrop layer so clicks inside the
          panel don't bubble up. */}
      <div
        data-testid="jobs-sidebar-backdrop"
        onClick={close}
        aria-hidden="true"
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-in fade-in duration-200"
      />

      {/* Panel */}
      <div
        ref={panelRef}
        data-testid="jobs-sidebar"
        className={cn(
          "absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-card shadow-2xl",
          "animate-in slide-in-from-right duration-300 ease-out"
        )}
      >
        {/* Header */}
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card/95 px-4 py-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold tracking-tight text-foreground">
              Trabajos
            </h2>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={openFullPage}
              data-testid="jobs-sidebar-open-page"
              title="Abrir página completa"
              aria-label="Abrir página completa"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground",
                "transition-colors hover:bg-muted hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              )}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Ver todo</span>
            </button>
            <Link
              href="/jobs"
              prefetch={false}
              onClick={close}
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
            />
            <button
              type="button"
              onClick={close}
              data-testid="jobs-sidebar-close"
              title="Cerrar"
              aria-label="Cerrar"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground",
                "transition-colors hover:bg-muted hover:text-foreground",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
              )}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Body — the shared panel content drives tabs, rows, and
            actions. The active-count callback feeds the nav
            button's badge. */}
        <JobsPanelContent
          variant="sidebar"
          onActiveCountChange={setActiveCount}
        />
      </div>
    </div>
  );
}

export default JobsSidebar;

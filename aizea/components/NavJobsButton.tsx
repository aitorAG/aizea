"use client";

// NavJobsButton — v1.11 nav-bar entry for the Jobs panel. Sits
// between "Inicio" and "Configuración" and surfaces a small badge
// with the total number of active jobs (running / pending) across
// every course. Clicking the button opens the right-side drawer
// (JobsSidebar), which is mounted by the root layout.
//
// Two interesting pieces:
//
//   1. The button is a `<button>`, not an `<a>`, because clicking
//      opens the drawer — not a navigation. Keyboard users can
//      still reach the full page by pressing the "Ver todo" link
//      inside the drawer.
//
//   2. The wrapping `relative` div owns the hover / focus state
//      for the preview. Putting the handlers on the wrapper (not
//      the button) means the mouse can travel from the button to
//      the preview without the preview disappearing mid-flight —
//      the wrapper element stays hovered the whole time.

import { useEffect, useRef, useState } from "react";
import { Briefcase } from "lucide-react";
import { cn } from "@/lib/utils";
import { useJobsUIStore } from "@/lib/stores/useJobsUIStore";
import { listActiveJobsAction } from "@/lib/actions/pipeline";
import { JobsPreview } from "@/components/JobsPreview";

const POLL_INTERVAL_MS = 3_000;
const HIDE_DELAY_MS = 120;

export function NavJobsButton() {
  const activeCount = useJobsUIStore((s) => s.activeCount);
  const setActiveCount = useJobsUIStore((s) => s.setActiveCount);
  const open = useJobsUIStore((s) => s.open);
  const [previewVisible, setPreviewVisible] = useState(false);
  /** Used to keep the preview open for a short window after the
   *  user moves the mouse off the wrapper — the wrapper's
   *  onMouseLeave would otherwise hide the popup before the
   *  user can read it. */
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await listActiveJobsAction({});
        if (cancelled) return;
        if (res.ok) {
          setActiveCount(res.jobs.length);
        }
      } catch {
        // best-effort
      }
    };
    void tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [setActiveCount]);

  const showPreview = () => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    setPreviewVisible(true);
  };
  const scheduleHidePreview = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setPreviewVisible(false);
      hideTimer.current = null;
    }, HIDE_DELAY_MS);
  };

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  return (
    <div
      className="relative"
      onMouseEnter={showPreview}
      onMouseLeave={scheduleHidePreview}
      onFocusCapture={showPreview}
      onBlurCapture={scheduleHidePreview}
    >
      <button
        type="button"
        onClick={open}
        data-testid="nav-jobs"
        aria-label="Abrir panel de trabajos"
        className={cn(
          "relative flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground",
          "transition-colors hover:text-foreground focus-visible:outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        )}
      >
        <Briefcase className="h-4 w-4" />
        <span className="hidden sm:inline">Trabajos</span>
        {activeCount > 0 && (
          <span
            data-testid="nav-jobs-badge"
            data-count={activeCount}
            className={cn(
              "inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full",
              "bg-primary px-1 font-mono text-[10px] font-semibold tabular-nums text-primary-foreground"
            )}
          >
            {activeCount}
          </span>
        )}
      </button>
      <JobsPreview visible={previewVisible} />
    </div>
  );
}

export default NavJobsButton;

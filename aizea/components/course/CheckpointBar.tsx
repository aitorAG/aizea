// CheckpointBar — sticky bottom navigation across the four course-flow
// pages. The bar is mounted exactly once per course by
// `app/courses/[id]/layout.tsx`, so it survives client-side navigations
// between /materials, /tree, /slides, and /slides/[id].
//
// Why client-side and not server-rendered:
//   The bar's "current phase" is derived from the live URL, which is
//   only available to a client component via `usePathname()`. If we
//   resolved the phase in the server layout, we'd need a different
//   layout per phase (or a layout that re-renders on every navigation,
//   which Next.js doesn't do). A single client component reading the
//   pathname is simpler, has zero server-side cost, and re-renders
//   automatically when the user navigates between pages.
//
// Why a single source of truth (icons.tsx):
//   The list of phases, their labels, their icons, and their URL
//   patterns all live in one place. Adding a fifth phase is a 5-line
//   change in icons.tsx and a 1-line extension of the matching chain
//   here. There is no second array to keep in sync.
//
// Per-phase availability (F4.2):
//   The layout passes an `availability` map (per phase, plus the
//   firstSlideId for the Detalle href). A phase whose resource is
//   not yet generated is rendered disabled (red, not a link, not
//   clickable). This is the design change that makes "clicking
//   Detalle on a course with no slides throws a 404" impossible —
//   the user simply cannot click the disabled item.
//
// z-index:
//   The bar sits at z-40. The GlobalPipelineBanner (mounted in
//   app/layout.tsx) is at z-[60], so when a pipeline is running, the
//   banner appears above the checkpoint bar. This is intentional: the
//   user has to be able to see pipeline progress even while on the
//   course flow pages.

"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CheckpointItem } from "./CheckpointItem";
import { CHECKPOINTS } from "./icons";

/**
 * Pure: given the current pathname and the courseId this bar belongs
 * to, return the 1-indexed phase number (1..4), or 0 if the pathname
 * doesn't match any of the four phases.
 *
 * IMPORTANT: when extending the match chain, put the *more specific*
 * predicates (e.g. /slides/[id]) BEFORE the less specific ones
 * (/slides), otherwise the generic one will win.
 */
export function getCurrentPhase(pathname: string, courseId: string): number {
  for (const cp of CHECKPOINTS) {
    if (cp.matches(pathname, courseId)) return cp.phase;
  }
  return 0;
}

/**
 * F4.2 — the four phases are gated by whether the resource for
 * that phase has been generated. The layout reads these from the
 * DB and passes them through. We default to all-available so the
 * bar keeps working in the Suspense fallback and in unit tests.
 */
export interface PhaseAvailability {
  1: boolean; // Carga — page always exists
  2: boolean; // Árbol — only after pipeline created TopicNodes
  3: boolean; // Slides — only after at least one Slide
  4: boolean; // Detalle — only after at least one Slide (to navigate to)
  /** ID of the first slide; used to build the Detalle href. */
  firstSlideId: string | null;
}

const DEFAULT_AVAILABILITY: PhaseAvailability = {
  1: true,
  2: true,
  3: true,
  4: true,
  firstSlideId: null,
};

interface CheckpointBarProps {
  /** Course id, used to scope the matchers and to build the hrefs. */
  courseId: string;
  /**
   * Optional override for tests / Storybook. When supplied, the bar
   * uses this phase instead of reading the URL. Production code
   * should always leave this undefined.
   */
  forcePhase?: number;
  /**
   * F4.2 — per-phase availability map. When omitted, every phase is
   * treated as available. The layout passes the DB-computed
   * availability here so the bar renders disabled (red, non-link)
   * for phases whose resource hasn't been generated yet.
   */
  availability?: PhaseAvailability;
}

export function CheckpointBar({
  courseId,
  forcePhase,
  availability = DEFAULT_AVAILABILITY,
}: CheckpointBarProps) {
  const pathname = usePathname() ?? "";
  const currentPhase = forcePhase ?? getCurrentPhase(pathname, courseId);

  return (
    <nav
      data-testid="checkpoint-bar"
      data-course-id={courseId}
      data-current-phase={currentPhase}
      aria-label="Fases del curso"
      // Fixed bottom bar — 56px on mobile, 64px on >= sm. The
      // `inset-x-0` keeps it flush with both edges. z-40 sits below
      // the GlobalPipelineBanner (z-[60]) so a running pipeline
      // notification still shows above the bar.
      className={cn(
        "fixed inset-x-0 bottom-0 z-40",
        "border-t border-border bg-white/95 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur",
        // safe-area-inset for notched phones (iOS, modern Android).
        "pb-[env(safe-area-inset-bottom,0px)]"
      )}
    >
      {/*
       * Inner container. mx-auto + max-w-6xl matches the rest of the
       * app's content width (see app/layout.tsx). justify-around
       * distributes the four items evenly with the same amount of
       * space on each side; on narrow screens the items grow
       * equally via flex-1.
       */}
      <ol
        data-testid="checkpoint-bar-items"
        className="mx-auto flex h-14 w-full max-w-6xl items-stretch justify-around px-2 sm:h-16 sm:px-4"
      >
        {CHECKPOINTS.map((cp) => (
          <li
            key={cp.phase}
            className="flex flex-1 items-stretch justify-center"
          >
            <CheckpointItem
              phase={cp.phase}
              currentPhase={currentPhase}
              href={cp.href(courseId, availability.firstSlideId)}
              icon={cp.icon}
              label={cp.label}
              // cp.phase is `number` (see icons.tsx) but
              // PhaseAvailability is keyed by the literal union 1|2|3|4.
              // We know from the descriptor list in icons.tsx that
              // cp.phase is always one of those four values at runtime;
              // the cast keeps the type narrow enough to index the
              // PhaseAvailability object without a wider index signature
              // (which would also admit `firstSlideId` and break the
              // boolean type at phase 4).
              available={availability[cp.phase as 1 | 2 | 3 | 4]}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}

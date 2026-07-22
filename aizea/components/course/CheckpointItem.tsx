// CheckpointItem — one of the four items in the course flow CheckpointBar.
//
// This component is *purely presentational*. It has no knowledge of the
// current pathname, no fetch logic, no client store. The parent
// (CheckpointBar) derives the current phase once and passes
// `currentPhase` down. The item itself compares `phase` to
// `currentPhase` to decide which of three visual treatments to render.
//
// Three states (in visual priority order):
//   - completed : phase < currentPhase. The user is past this step.
//                 Rendered with a green check and muted text. Still a
//                 link (the user can jump back).
//   - current   : phase === currentPhase. The user is here. Rendered
//                 with the primary color, a dot indicator below the
//                 icon, and aria-current="page" for accessibility.
//   - upcoming  : phase > currentPhase. The user hasn't reached this
//                 step yet. Rendered with muted gray and the same
//                 icon (no check) so the visual rhythm of the bar is
//                 consistent.
//
// A fourth, orthogonal dimension: `available` (F4.2).
//   When the resource for this phase hasn't been generated yet
//   (no tree, no slides), the item is rendered as a non-link span
//   with red text, a `cursor-not-allowed` and `aria-disabled` for
//   screen readers. The bar is not clickable but stays visible so
//   the user understands the phase exists and what they need to do
//   to reach it (the empty state for that phase tells them).

import { cn } from "@/lib/utils";
import Link from "next/link";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type CheckpointState = "completed" | "current" | "upcoming";

/**
 * Pure function: given an item's phase and the current page's phase,
 * returns the visual state. Extracted so the unit test doesn't need to
 * render a DOM to verify the truth table.
 */
export function deriveCheckpointState(
  phase: number,
  currentPhase: number
): CheckpointState {
  if (phase < currentPhase) return "completed";
  if (phase === currentPhase) return "current";
  return "upcoming";
}

interface CheckpointItemProps {
  /** The phase this item represents (1, 2, 3, or 4). */
  phase: number;
  /** The phase of the page the user is currently on. */
  currentPhase: number;
  /** href the link navigates to. */
  href: string;
  /** Lucide icon for the upcoming/inactive state. */
  icon: LucideIcon;
  /** Short label, e.g. "Carga", "Árbol", "Slides", "Detalle". */
  label: string;
  /**
   * F4.2 — is the resource for this phase generated in the DB?
   *
   * - `true`  → normal clickable link
   * - `false` → rendered as a non-link span with red text, the icon
   *            is also red, and `aria-disabled="true"` is set so screen
   *            readers announce it as unavailable.
   *
   * The default is `true` so the CheckpointBar keeps working when the
   * parent doesn't pass `availability` (tests, Storybook, or the
   * Suspense fallback in the layout).
   */
  available?: boolean;
}

export function CheckpointItem({
  phase,
  currentPhase,
  href,
  icon: Icon,
  label,
  available = true,
}: CheckpointItemProps) {
  const state = deriveCheckpointState(phase, currentPhase);
  const isCurrent = state === "current";
  const isCompleted = state === "completed";
  const isUnavailable = !available;

  // The disabled case: render a span, not a Link. We still show the
  // icon + label so the user understands the phase exists; the red
  // colour and `aria-disabled` say "you can't go here yet".
  const content = (
    <>
      {/*
       * Icon container. The completed state swaps the supplied icon
       * for a green check so the user can see at a glance that they
       * already passed this step. The current state keeps the icon
       * but turns it the primary color via the parent's text-current
       * utility above.
       */}
      <span
        aria-hidden="true"
        className={cn(
          "relative flex h-5 w-5 items-center justify-center sm:h-6 sm:w-6",
          isCurrent && "scale-110"
        )}
      >
        {isCompleted ? (
          <Check className="h-full w-full" strokeWidth={2.5} />
        ) : (
          <Icon className="h-full w-full" strokeWidth={isCurrent ? 2.25 : 2} />
        )}
      </span>

      <span
        className={cn(
          "truncate text-[10px] font-medium uppercase tracking-wider sm:text-[11px]",
          isCurrent && "font-bold",
          isCompleted && "font-medium"
        )}
      >
        {label}
      </span>

      {isCurrent && (
        <span
          aria-hidden="true"
          data-testid="checkpoint-current-dot"
          className="absolute -bottom-0.5 h-1 w-1 rounded-full bg-primary sm:bottom-0"
        />
      )}
    </>
  );

  // Shared className so both branches render the same way visually —
  // just the colour + interactivity changes.
  const baseClassName = cn(
    "group relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2 sm:gap-1 sm:px-2 sm:py-2.5",
    "min-h-[44px] rounded-md",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "transition-colors",
    // Colour by state. Unavailable wins over all other colour logic
    // — red is the single source of "you can't go here yet".
    isUnavailable && "text-red-500",
    !isUnavailable && isCurrent && "text-primary",
    !isUnavailable && isCompleted && "text-emerald-600",
    !isUnavailable &&
      !isCurrent &&
      !isCompleted &&
      "text-muted-foreground hover:text-foreground",
    // Disabled visual: no hover effect, not-allowed cursor, dimmed.
    isUnavailable && "cursor-not-allowed"
  );

  if (isUnavailable) {
    return (
      <span
        data-testid="checkpoint-item"
        data-phase={phase}
        data-state={state}
        data-available="false"
        aria-disabled="true"
        // Screen readers announce this as "Detalle, unavailable,
        // dimmed" (the third param of aria-disabled is the "dimmed"
        // hint that's part of the spec).
        aria-label={`${label} (no disponible — genera el recurso primero)`}
        className={baseClassName}
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      href={href}
      data-testid="checkpoint-item"
      data-phase={phase}
      data-state={state}
      data-available="true"
      aria-current={isCurrent ? "page" : undefined}
      aria-label={`${label}${isCurrent ? " (página actual)" : ""}`}
      className={baseClassName}
    >
      {content}
    </Link>
  );
}

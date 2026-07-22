// Phase metadata for the CheckpointBar.
//
// This module is a pure data table — no React, no client-side hooks — so it
// can be imported from server components (the course layout), client
// components (the CheckpointBar itself), and unit tests without dragging
// the whole icon bundle into a test run.
//
// Adding a new phase is a single, localized change:
//   1. Add a row here.
//   2. Extend the matching URL pattern in `getCurrentPhase` in
//      CheckpointBar.tsx.

import { Upload, Network, Presentation, PencilLine } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface CheckpointDescriptor {
  /** Stable numeric id of the phase, 1-indexed. */
  phase: number;
  /** Short, human-readable label shown under the icon. */
  label: string;
  /** Lucide icon component for the inactive/upcoming state. */
  icon: LucideIcon;
  /**
   * Pure predicate: given the live pathname, is THIS phase the current
   * one? The first descriptor whose predicate returns true wins. Order
   * matters when a path is ambiguous (e.g. /slides matches phase 3 but
   * /slides/[id] is phase 4 — see CheckpointBar.tsx for ordering).
   */
  matches: (pathname: string, courseId: string) => boolean;
  /**
   * href builder — receives the courseId and returns the target URL.
   * The "Detalle" href is computed from the availability map
   * (firstSlideId) at the point of rendering, so the CheckpointBar
   * passes it through.
   */
  href: (courseId: string, firstSlideId: string | null) => string;
}

export const CHECKPOINTS: readonly CheckpointDescriptor[] = [
  {
    phase: 1,
    label: "Carga",
    icon: Upload,
    matches: (pathname, courseId) =>
      pathname === `/courses/${courseId}/materials`,
    href: (courseId) => `/courses/${courseId}/materials`,
  },
  {
    phase: 2,
    label: "Árbol",
    icon: Network,
    matches: (pathname, courseId) => pathname === `/courses/${courseId}/tree`,
    href: (courseId) => `/courses/${courseId}/tree`,
  },
  {
    // NOTE: phase 3 is the slides INDEX. The detail page (phase 4) is a
    // deeper path, so it must be tested BEFORE phase 3 in the predicate
    // chain. The "matches" predicate deliberately does NOT match
    // /slides/[slideId] — that one belongs to phase 4 below.
    phase: 3,
    label: "Slides",
    icon: Presentation,
    matches: (pathname, courseId) =>
      pathname === `/courses/${courseId}/slides`,
    href: (courseId) => `/courses/${courseId}/slides`,
  },
  {
    phase: 4,
    label: "Detalle",
    icon: PencilLine,
    matches: (pathname, courseId) =>
      pathname.startsWith(`/courses/${courseId}/slides/`),
    // F4.2 — when at least one slide exists, the Detalle link goes
    // directly to the first slide's detail page. When no slide
    // exists, the bar is still rendered (so the layout is stable)
    // but the item is disabled (see CheckpointItem + the
    // `available` prop on this descriptor). The fallback to the
    // slides INDEX keeps the link valid even when firstSlideId is
    // null — the item's `aria-disabled` and the bar's `disabled`
    // styling prevent the user from actually clicking through.
    href: (courseId, firstSlideId) =>
      firstSlideId
        ? `/courses/${courseId}/slides/${firstSlideId}`
        : `/courses/${courseId}/slides`,
  },
] as const;

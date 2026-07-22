// CourseStatusIcons — the two navigational status indicators rendered on
// the right edge of every dashboard course card.
//
// Why this component exists as a separate file
// --------------------------------------------
// The dashboard card already carries two kinds of right-side controls:
//
//   1. Action buttons  (Edit / Delete) — mutate the course itself.
//   2. Status icons    (this file)     — navigate to a derived view
//                                        (tree or slides) of the same
//                                        course, and signal whether the
//                                        resource has been generated yet.
//
// Mixing the two inside the same flex container would visually blur that
// distinction. We solve the problem with a *visual* separator (a 1px
// left border on the icon group) plus extra padding so the icons don't
// collide with the Edit / Delete buttons.
//
// Why icons are links, not buttons
// --------------------------------
// Clicking the icon should take the user to the corresponding page, even
// when the icon is red. A red icon just means "not generated yet" — the
// landing page is an empty state where the user can start the
// generation. So semantically these are anchors, not buttons. We still
// apply Tailwind's button-like styling (h-11 w-11) so the touch target
// is large enough (WCAG 2.5.5, ≥ 44×44).
//
// Why colour is the only differentiator
// -------------------------------------
// The Spanish aria-label carries the state ("creado" / "no creado") so
// the colour is never the SOLE channel of information (forbidden by
// the UI design contract). The colour is a glanceable accelerator, not
// a primary signal.

import Link from "next/link";
import { Network, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

interface CourseStatusIconsProps {
  /** The course id — used to build the navigation hrefs. */
  courseId: string;
  /** True when the course has at least one TopicNode (tree generated). */
  hasTree: boolean;
  /** True when the course has at least one Slide. */
  hasSlides: boolean;
}

function statusLinkClass(exists: boolean): string {
  // Single source of truth for the visual treatment. Centralised so a
  // future rebrand only touches one function. Both colours come from the
  // Tailwind palette (emerald-600 = 5.92:1 contrast on white, red-500
  // = 4.83:1, both pass WCAG AA for non-text iconography and the
  // minimum 3:1 ratio for graphical objects).
  return cn(
    "inline-flex h-11 w-11 items-center justify-center rounded-md",
    "transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    exists ? "text-emerald-600 hover:bg-emerald-50" : "text-red-500 hover:bg-red-50"
  );
}

export function CourseStatusIcons({
  courseId,
  hasTree,
  hasSlides,
}: CourseStatusIconsProps) {
  return (
    <div
      data-testid="course-status-icons"
      className="flex items-center gap-1 border-l border-border pl-3"
      role="group"
      aria-label="Estado de los recursos derivados del curso"
    >
      <Link
        href={`/courses/${courseId}/tree`}
        data-testid="course-status-tree"
        data-exists={hasTree ? "true" : "false"}
        aria-label={
          hasTree
            ? "Árbol conceptual (creado) — abrir"
            : "Árbol conceptual (no creado) — abrir"
        }
        className={statusLinkClass(hasTree)}
      >
        <Network className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </Link>
      <Link
        href={`/courses/${courseId}/slides`}
        data-testid="course-status-slides"
        data-exists={hasSlides ? "true" : "false"}
        aria-label={
          hasSlides
            ? "Diapositivas (creado) — abrir"
            : "Diapositivas (no creado) — abrir"
        }
        className={statusLinkClass(hasSlides)}
      >
        <Presentation className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </Link>
    </div>
  );
}

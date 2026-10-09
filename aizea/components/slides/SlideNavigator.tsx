"use client";

// SlideNavigator — F5.2.
//
// The navigator is the per-page answer to "I'm in slide 3 of 10; how
// do I get to slide 7 without going back to the list?". It is a pure
// component: it owns no network or routing state, just a dropdown and
// two buttons. All it does is call `onNavigate(newSlideId)`.
//
// Design rationale (see also tests/unit/slide-navigator.test.tsx):
//   - We use a real <select> instead of a custom combobox because the
//     native element is accessible, keyboard-navigable, and works on
//     every platform. The dropdown's accessible name comes from the
//     aria-label "Saltar a diapositiva" so screen readers announce
//     it as a list of 10 options, not as a generic combobox.
//   - The "Anterior" / "Siguiente" buttons include the target slide's
//     title in the aria-label so blind users hear the destination
//     before activating the button — they don't have to guess where
//     "next" is going to take them.
//   - Boundary handling: when currentSlideId is unknown (stale URL,
//     deleted slide) we render 0 / N and disable both nav buttons
//     rather than crashing. The dropdown is rendered but no option is
//     selected. The same applies when slides is empty.
//   - We never re-emit onNavigate for the currently-selected slide.
//     This keeps the parent free of pointless router.push calls when
//     the user re-opens the same option in the dropdown.

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale, useTranslations } from "@/components/LocaleProvider";

export interface SlideNavItem {
  id: string;
  title: string;
  order: number;
  /** v1.0 — hierarchical number (e.g. "1.2.3"). Shown as a muted
   *  prefix in the dropdown so the user can jump by the same
   *  numbering scheme used across the tree and exports. */
  numericPath?: string | null;
}

interface SlideNavigatorProps {
  courseId: string;
  currentSlideId: string;
  slides: SlideNavItem[];
  onNavigate: (slideId: string) => void;
  className?: string;
}

export function SlideNavigator({
  courseId,
  currentSlideId,
  slides,
  onNavigate,
  className,
}: SlideNavigatorProps) {
  const t = useTranslations();
  const locale = useLocale();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  // Sort by `order` so the dropdown matches the on-disk order even if
  // the caller passed the list in a different order (e.g. by id).
  const ordered = [...slides].sort((a, b) => a.order - b.order);

  const currentIndex = ordered.findIndex((s) => s.id === currentSlideId);
  const hasCurrent = currentIndex >= 0;
  const hasPrev = hasCurrent && currentIndex > 0;
  const hasNext = hasCurrent && currentIndex < ordered.length - 1;
  const prevSlide = hasPrev ? ordered[currentIndex - 1] : undefined;
  const nextSlide = hasNext ? ordered[currentIndex + 1] : undefined;

  const position = hasCurrent ? currentIndex + 1 : 0;
  const total = ordered.length;
  // v1.0 — the current slide's hierarchical number, shown next to the
  // position counter when available (non-invasive, muted).
  const currentNumber = hasCurrent
    ? ordered[currentIndex].numericPath ?? null
    : null;

  return (
    <div
      data-testid="slide-navigator"
      data-course-id={courseId}
      data-current-slide-id={currentSlideId}
      className={cn(
        "flex flex-col gap-2 rounded-md border border-border bg-card p-3 shadow-sm",
        "sm:flex-row sm:items-center sm:gap-3",
        className
      )}
      role="group"
      aria-label={t("slides.navigation")}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => prevSlide && onNavigate(prevSlide.id)}
        disabled={!hasPrev}
        aria-label={
          prevSlide
            ? t("slides.previousTarget", { title: prevSlide.title })
            : t("slides.noPrevious")
        }
        data-testid="slide-navigator-prev"
        className="gap-1"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="hidden sm:inline">{t("slides.previous")}</span>
      </Button>

      <div className="flex flex-1 items-center gap-2">
        <label htmlFor="slide-navigator-select" className="sr-only">
          {t("slides.jumpTo")}
        </label>
        <select
          id="slide-navigator-select"
          data-testid="slide-navigator-select"
          value={currentSlideId}
          onChange={(e) => {
            const next = e.target.value;
            if (next && next !== currentSlideId) onNavigate(next);
          }}
          // Native <select> — we set the visible width with min-w-0 +
          // flex-1 so it grows inside the toolbar. The full option
          // text is also rendered as truncated, but with the order
          // prefix the user can find a slide quickly even on mobile.
          className={cn(
            "flex h-9 w-full min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50"
          )}
          aria-label={t("slides.jumpTo")}
        >
          {ordered.length === 0 ? (
            <option value="">{t("slides.noneOption")}</option>
          ) : (
            ordered.map((s) => (
              <option key={s.id} value={s.id}>
                {s.numericPath
                  ? `${s.numericPath} · ${s.title}`
                  : `${number(s.order + 1)}. ${s.title}`}
              </option>
            ))
          )}
        </select>

        {currentNumber && (
          <span
            data-testid="slide-navigator-number"
            className="shrink-0 rounded-md bg-muted/60 px-2 py-1 text-xs font-mono tabular-nums text-muted-foreground"
            title={t("slides.hierarchyNumber", { number: currentNumber })}
          >
            {currentNumber}
          </span>
        )}
        <span
          data-testid="slide-navigator-counter"
          aria-live="polite"
          className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-mono tabular-nums text-muted-foreground"
        >
          {number(position)} / {number(total)}
        </span>
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => nextSlide && onNavigate(nextSlide.id)}
        disabled={!hasNext}
        aria-label={
          nextSlide
            ? t("slides.nextTarget", { title: nextSlide.title })
            : t("slides.noNext")
        }
        data-testid="slide-navigator-next"
        className="gap-1"
      >
        <span className="hidden sm:inline">{t("slides.next")}</span>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}

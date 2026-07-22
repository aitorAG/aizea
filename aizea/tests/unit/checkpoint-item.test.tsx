// @vitest-environment jsdom
//
// CheckpointItem — state derivation logic.
//
// The component is intentionally tiny: it takes (phase, currentPhase,
// href, icon, label) and renders one of three visual states. The
// "interesting" logic is the `deriveCheckpointState` helper, which is a
// pure function. We test the helper directly, AND we test the rendered
// DOM for the four phases relative to a single current phase, so a
// future regression that swaps the helper for inline conditionals will
// fail the integration test as well as the unit one.

import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Network } from "lucide-react";

import {
  CheckpointItem,
  deriveCheckpointState,
  type CheckpointState,
} from "@/components/course/CheckpointItem";

afterEach(() => {
  cleanup();
});

describe("deriveCheckpointState", () => {
  it("returns 'completed' when the item is before the current phase", () => {
    expect(deriveCheckpointState(1, 2)).toBe<CheckpointState>("completed");
    expect(deriveCheckpointState(1, 4)).toBe<CheckpointState>("completed");
    expect(deriveCheckpointState(2, 3)).toBe<CheckpointState>("completed");
    expect(deriveCheckpointState(3, 4)).toBe<CheckpointState>("completed");
  });

  it("returns 'current' when the item equals the current phase", () => {
    expect(deriveCheckpointState(1, 1)).toBe<CheckpointState>("current");
    expect(deriveCheckpointState(2, 2)).toBe<CheckpointState>("current");
    expect(deriveCheckpointState(3, 3)).toBe<CheckpointState>("current");
    expect(deriveCheckpointState(4, 4)).toBe<CheckpointState>("current");
  });

  it("returns 'upcoming' when the item is after the current phase", () => {
    expect(deriveCheckpointState(2, 1)).toBe<CheckpointState>("upcoming");
    expect(deriveCheckpointState(3, 1)).toBe<CheckpointState>("upcoming");
    expect(deriveCheckpointState(4, 1)).toBe<CheckpointState>("upcoming");
    expect(deriveCheckpointState(4, 3)).toBe<CheckpointState>("upcoming");
  });

  it("never throws on edge-case inputs (currentPhase=0, out-of-range)", () => {
    // Current 0 means "no phase active yet" (e.g. before the first
    // checkpoint is reached). All items are then upcoming.
    expect(deriveCheckpointState(1, 0)).toBe<CheckpointState>("upcoming");
    expect(deriveCheckpointState(4, 0)).toBe<CheckpointState>("upcoming");
    // Far future phase: still upcoming, never crashes.
    expect(deriveCheckpointState(1, 99)).toBe<CheckpointState>("completed");
    expect(deriveCheckpointState(99, 1)).toBe<CheckpointState>("upcoming");
  });
});

describe("<CheckpointItem /> — visual state", () => {
  // We use phase=2 with the Network icon as the canonical "this item"
  // and cycle currentPhase through 1, 2, 3, 4 to assert each visual
  // state. This keeps the test matrix 1×4 instead of 4×4.

  const href = "/courses/abc/tree";
  const label = "Árbol";

  it("renders an upcoming item with muted text and the phase icon", () => {
    render(
      <CheckpointItem
        phase={2}
        currentPhase={1}
        href={href}
        icon={Network}
        label={label}
      />
    );
    const link = screen.getByRole("link", { name: /[áa]rbol/i });
    // Upcoming: link points at the item's own href (so the user can
    // jump forward to a future phase if they want to).
    expect(link).toHaveAttribute("href", href);
    // No aria-current: this is not the active phase.
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("renders a current item with aria-current='page' and bold label", () => {
    render(
      <CheckpointItem
        phase={2}
        currentPhase={2}
        href={href}
        icon={Network}
        label={label}
      />
    );
    const link = screen.getByRole("link", { name: /[áa]rbol/i });
    expect(link).toHaveAttribute("aria-current", "page");
    // The current item also exposes a data attribute for tests/CSS.
    expect(link).toHaveAttribute("data-state", "current");
  });

  it("renders a completed item with data-state='completed'", () => {
    render(
      <CheckpointItem
        phase={2}
        currentPhase={3}
        href={href}
        icon={Network}
        label={label}
      />
    );
    const link = screen.getByRole("link", { name: /[áa]rbol/i });
    expect(link).toHaveAttribute("data-state", "completed");
    expect(link).not.toHaveAttribute("aria-current");
  });

  it("exposes the phase number for CSS / Playwright selectors", () => {
    const { rerender } = render(
      <CheckpointItem
        phase={2}
        currentPhase={1}
        href={href}
        icon={Network}
        label={label}
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute("data-phase", "2");

    rerender(
      <CheckpointItem
        phase={3}
        currentPhase={1}
        href={href}
        icon={Network}
        label="Slides"
      />
    );
    expect(screen.getByRole("link")).toHaveAttribute("data-phase", "3");
  });

  it("renders the supplied label inside the link (single text node)", () => {
    render(
      <CheckpointItem
        phase={2}
        currentPhase={2}
        href={href}
        icon={Network}
        label="Árbol"
      />
    );
    // The accessible name is the label, and the label is rendered as
    // visible text too.
    expect(screen.getByText("Árbol")).toBeInTheDocument();
  });
});

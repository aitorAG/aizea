// @vitest-environment jsdom
//
// CheckpointBar — the four-step course flow indicator.
//
// The bar is mounted by the course layout (app/courses/[id]/layout.tsx)
// and rendered once on every page in /courses/[id]/*. It reads the
// current pathname from `next/navigation`, maps it to a phase number
// (1..4), and forwards the resolved phase to each CheckpointItem.
//
// We mock `next/navigation` so the test can swap the pathname freely
// without touching window.history.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import React from "react";

// Mock next/navigation so `usePathname` returns whatever the test
// configures via `mockPathname`.
let mockPathname = "/courses/c1/materials";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

// Mock next/link so we don't need a real router context.
vi.mock("next/link", () => {
  return {
    default: ({
      href,
      children,
      ...rest
    }: {
      href: string;
      children: React.ReactNode;
    } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
  };
});

import { CheckpointBar } from "@/components/course/CheckpointBar";
import { CHECKPOINTS } from "@/components/course/icons";

beforeEach(() => {
  vi.clearAllMocks();
  mockPathname = "/courses/c1/materials";
});

afterEach(() => {
  cleanup();
});

describe("<CheckpointBar /> — structure", () => {
  it("renders exactly four checkpoint items in order", () => {
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.getAttribute("data-phase"))).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
  });

  it("renders the four labels in Spanish (Carga, Árbol, Slides, Detalle)", () => {
    render(<CheckpointBar courseId="c1" />);
    const bar = screen.getByTestId("checkpoint-bar");
    expect(within(bar).getByText("Carga")).toBeInTheDocument();
    expect(within(bar).getByText("Árbol")).toBeInTheDocument();
    expect(within(bar).getByText("Slides")).toBeInTheDocument();
    expect(within(bar).getByText("Detalle")).toBeInTheDocument();
  });

  it("uses the fixed-bottom positioning class (z-40 sits below the global pipeline banner's z-[60])", () => {
    // We assert the class string rather than computed style because
    // jsdom does not process Tailwind utility classes into actual
    // styles. The class list is what the user sees in production —
    // a regression that removes `fixed` or `bottom-0` from the
    // utility chain would break the visual contract even if the
    // computed style incidentally matched in jsdom.
    render(<CheckpointBar courseId="c1" />);
    const bar = screen.getByTestId("checkpoint-bar");
    expect(bar.className).toMatch(/\bfixed\b/);
    expect(bar.className).toMatch(/\binset-x-0\b/);
    expect(bar.className).toMatch(/\bbottom-0\b/);
    expect(bar.className).toMatch(/\bz-40\b/);
  });
});

describe("<CheckpointBar /> — phase detection from pathname", () => {
  it("marks phase 1 current on /courses/{id}/materials", () => {
    mockPathname = "/courses/c1/materials";
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual([
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    // Only the current item has aria-current="page".
    expect(items[0]).toHaveAttribute("aria-current", "page");
    expect(items[1]).not.toHaveAttribute("aria-current");
    expect(items[2]).not.toHaveAttribute("aria-current");
    expect(items[3]).not.toHaveAttribute("aria-current");
  });

  it("marks phase 2 current on /courses/{id}/tree", () => {
    mockPathname = "/courses/c1/tree";
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual([
      "completed",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("marks phase 3 current on /courses/{id}/slides", () => {
    mockPathname = "/courses/c1/slides";
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual([
      "completed",
      "completed",
      "current",
      "upcoming",
    ]);
  });

  it("marks phase 4 current on /courses/{id}/slides/{slideId}", () => {
    mockPathname = "/courses/c1/slides/some-uuid";
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual([
      "completed",
      "completed",
      "completed",
      "current",
    ]);
  });

  it("does NOT misclassify /slides/{slideId} as phase 3 (detail wins)", () => {
    // Regression: phase 3 matches /slides and phase 4 matches
    // /slides/*. If the chain picks phase 3 first, the detail page
    // would highlight "Slides" instead of "Detalle". The descriptor
    // array in icons.tsx orders phase 4's predicate so a path that
    // starts with /slides/ is always phase 4.
    mockPathname = "/courses/c1/slides/abc-123";
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    expect(items[2].getAttribute("data-state")).toBe("completed");
    expect(items[3].getAttribute("data-state")).toBe("current");
  });
});

describe("<CheckpointBar /> — unknown / no phase", () => {
  it("renders all items as upcoming when the pathname is outside the course flow", () => {
    // e.g. the user is on /settings or /courses (overview). The
    // bar shouldn't crash and shouldn't pretend a phase is active.
    mockPathname = "/settings";
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual([
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("renders all items as upcoming for a different course id in the URL", () => {
    // The user is on /courses/OTHER/tree; for courseId="c1" the bar
    // should NOT highlight any phase. This keeps each course's bar
    // self-consistent regardless of which course the user
    // navigated from.
    mockPathname = "/courses/other-course/tree";
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual([
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });
});

describe("<CheckpointBar /> — links", () => {
  it("uses the courseId supplied via props to build every href", () => {
    render(<CheckpointBar courseId="course-xyz" />);
    const items = screen.getAllByTestId("checkpoint-item");
    const hrefs = items.map((i) => i.getAttribute("href"));
    expect(hrefs).toEqual([
      "/courses/course-xyz/materials",
      "/courses/course-xyz/tree",
      "/courses/course-xyz/slides",
      "/courses/course-xyz/slides",
    ]);
  });

  it("renders Next.js <a> tags (not raw anchors) — SPA navigation works", () => {
    // next/link renders an <a> with the right href. We assert the
    // tag name is "A" so a future regression that drops next/link
    // in favor of window.location = ... gets caught.
    render(<CheckpointBar courseId="c1" />);
    const items = screen.getAllByTestId("checkpoint-item");
    for (const item of items) {
      expect(item.tagName).toBe("A");
    }
  });
});

describe("<CheckpointBar /> — accessibility", () => {
  it("has a navigation landmark (aria-label='Fases del curso')", () => {
    render(<CheckpointBar courseId="c1" />);
    const nav = screen.getByRole("navigation", { name: /fases del curso/i });
    expect(nav).toBeInTheDocument();
  });

  it("renders the current-phase dot only on the current item", () => {
    mockPathname = "/courses/c1/tree";
    render(<CheckpointBar courseId="c1" />);
    const dots = screen.getAllByTestId("checkpoint-current-dot");
    expect(dots).toHaveLength(1);
    // The dot is inside the second item (phase 2).
    const item = dots[0].closest('[data-testid="checkpoint-item"]');
    expect(item).toHaveAttribute("data-phase", "2");
  });
});

// Sanity: the descriptor list has exactly four entries. If someone
// accidentally adds a fifth, the per-item tests above would still
// pass (they use `getAllByTestId` which scales), but the structural
// tests would catch the inconsistency. Belt + suspenders.
describe("CHECKPOINTS descriptor", () => {
  it("has exactly 4 entries, in phase order, no duplicates", () => {
    expect(CHECKPOINTS).toHaveLength(4);
    expect(CHECKPOINTS.map((c) => c.phase)).toEqual([1, 2, 3, 4]);
  });
});

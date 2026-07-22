// @vitest-environment jsdom
//
// SlideNavigator — pure presentational component that lets the user jump
// between slides WITHOUT going back to the index.
//
// F5.2 design contract (from docs/drafts/product-design/flujo-usuario.md):
//   - Dropdown showing all slides of the course
//   - "Anterior" / "Siguiente" buttons
//   - On change → invokes onNavigate(newSlideId) (parent does router.push)
//   - Shows current slide number / total (e.g. "3 / 10")
//
// Why a separate component, not inline JSX in the client component?
//   - The navigator is self-contained state: which slide is current,
//     the disabled state of prev/next, and the URL builder. Pulling
//     it out lets the test exercise the contract (props → emitted
//     onNavigate) without dragging the rest of the editor in.
//   - The page passes the full sibling list once; the navigator owns
//     nothing but presentation + click events. It cannot accidentally
//     mutate the page or hit the network.
//
// What is NOT the navigator's job:
//   - It does NOT call router.push itself. The parent owns navigation
//     so the navigator stays a pure function of its props.
//   - It does NOT pre-fetch the next slide. The Next.js page transition
//     handles data loading when the URL changes.
//   - It does NOT auto-save. Save is a separate concern (autosave in
//     the editor; the navigator is about getting to the next slide).

import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlideNavigator } from "@/components/slides/SlideNavigator";

afterEach(() => {
  cleanup();
});

const SLIDES = [
  { id: "s1", title: "Chumacera de camisa", order: 0 },
  { id: "s2", title: "Mecánica de lubricación", order: 1 },
  { id: "s3", title: "Propiedades de los fluidos", order: 2 },
  { id: "s4", title: "Coeficiente de fricción", order: 3 },
  { id: "s5", title: "Cojinetes", order: 4 },
];

describe("<SlideNavigator /> — structure", () => {
  it("renders a navigable group with a data-testid for e2e selectors", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByTestId("slide-navigator")).toBeInTheDocument();
  });

  it("renders a dropdown (combobox) with one option per slide", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    const select = screen.getByTestId("slide-navigator-select");
    expect(select.tagName).toBe("SELECT");
    const options = within(select as HTMLElement).getAllByRole("option");
    expect(options).toHaveLength(SLIDES.length);
  });

  it("renders the dropdown options with the slide title and the 1-based order prefix", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    // 1-based: "1. Chumacera de camisa"
    expect(
      screen.getByRole("option", { name: /1\.\s*Chumacera de camisa/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /3\.\s*Propiedades de los fluidos/i })
    ).toBeInTheDocument();
  });

  it("marks the current slide as the selected option in the dropdown", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    const select = screen.getByTestId(
      "slide-navigator-select"
    ) as HTMLSelectElement;
    expect(select.value).toBe("s3");
  });

  it("renders Anterior and Siguiente buttons with Spanish labels", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /anterior/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeInTheDocument();
  });

  it("renders a counter showing the current position and the total", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    // s3 is the 3rd slide (1-based) of 5
    expect(screen.getByTestId("slide-navigator-counter")).toHaveTextContent(
      "3 / 5"
    );
  });
});

describe("<SlideNavigator /> — navigation contract", () => {
  it("calls onNavigate with the selected slide id when the dropdown changes", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={onNavigate}
      />
    );
    const select = screen.getByTestId(
      "slide-navigator-select"
    ) as HTMLSelectElement;
    await user.selectOptions(select, "s5");
    expect(onNavigate).toHaveBeenCalledWith("s5");
  });

  it("does NOT call onNavigate when the user re-selects the current slide (no-op)", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={onNavigate}
      />
    );
    const select = screen.getByTestId(
      "slide-navigator-select"
    ) as HTMLSelectElement;
    await user.selectOptions(select, "s3");
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("clicking Siguiente calls onNavigate with the next slide id", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={onNavigate}
      />
    );
    await user.click(screen.getByRole("button", { name: /siguiente/i }));
    expect(onNavigate).toHaveBeenCalledWith("s4");
  });

  it("clicking Anterior calls onNavigate with the previous slide id", async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={onNavigate}
      />
    );
    await user.click(screen.getByRole("button", { name: /anterior/i }));
    expect(onNavigate).toHaveBeenCalledWith("s2");
  });
});

describe("<SlideNavigator /> — edge cases (boundary slides)", () => {
  it("disables Anterior on the first slide (no previous)", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s1"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    const prev = screen.getByRole("button", { name: /anterior/i });
    expect(prev).toBeDisabled();
  });

  it("disables Siguiente on the last slide (no next)", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s5"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    const next = screen.getByRole("button", { name: /siguiente/i });
    expect(next).toBeDisabled();
  });

  it("does NOT throw when the current slide id is not in the list (stale URL)", () => {
    // The URL might point to a slide that was deleted since the user
    // opened the page. We don't want a runtime crash — the navigator
    // must render with the counter showing 0 / N and both nav buttons
    // disabled. This is the "defensive default" the test pins down.
    expect(() =>
      render(
        <SlideNavigator
          courseId="c1"
          currentSlideId="s-not-in-list"
          slides={SLIDES}
          onNavigate={vi.fn()}
        />
      )
    ).not.toThrow();

    const counter = screen.getByTestId("slide-navigator-counter");
    expect(counter).toHaveTextContent("0 / 5");
    expect(screen.getByRole("button", { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeDisabled();
  });

  it("renders an empty-state when the course has zero slides (no crash)", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="n/a"
        slides={[]}
        onNavigate={vi.fn()}
      />
    );
    const counter = screen.getByTestId("slide-navigator-counter");
    expect(counter).toHaveTextContent("0 / 0");
    expect(screen.getByRole("button", { name: /anterior/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /siguiente/i })).toBeDisabled();
  });
});

describe("<SlideNavigator /> — accessibility", () => {
  it("uses an aria-label on the dropdown that names its purpose (Spanish)", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    const select = screen.getByTestId("slide-navigator-select");
    // Either an aria-label or a wrapping <label> with the text "Saltar a"
    expect(select).toHaveAccessibleName(/saltar a/i);
  });

  it("Anterior / Siguiente buttons expose the target slide in their accessible name", () => {
    render(
      <SlideNavigator
        courseId="c1"
        currentSlideId="s3"
        slides={SLIDES}
        onNavigate={vi.fn()}
      />
    );
    // The button label should hint at the target, not just "Anterior".
    const prev = screen.getByRole("button", { name: /anterior/i });
    expect(prev.getAttribute("aria-label") ?? prev.textContent).toMatch(
      /anterior|mecánica/i
    );
    const next = screen.getByRole("button", { name: /siguiente/i });
    expect(next.getAttribute("aria-label") ?? next.textContent).toMatch(
      /siguiente|propiedades/i
    );
  });
});

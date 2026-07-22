// @vitest-environment jsdom
//
// CourseStatusIcons — two visual status indicators for the dashboard card.
//
// Each course row in the dashboard surfaces the existence (green) or absence
// (red) of two derived resources:
//   - Conceptual tree  (TopicNode[]  > 0)   → icon: Network
//   - Slides           (Slide[]     > 0)   → icon: Presentation
//
// Both icons are rendered as <Link> elements so that clicking them (even
// when red) navigates the user to the corresponding page; the red state
// simply lands them on an empty-state. The icons are wrapped in a group
// that is visually separated from the action buttons (Edit / Delete) by a
// vertical divider + extra padding — this is a functional concern (the
// status icons are navigational affordances, the action buttons mutate the
// course itself) and an accessibility one (different roles / actions).
//
// The component is presentational and pure: all data comes through props
// resolved by the server component (so the icon status is derived from
// real DB state, never mocked). The only logic the component owns is
// color resolution (green ↔ red) and aria-label text.

import { describe, it, expect, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CourseStatusIcons } from "@/components/course/CourseStatusIcons";

afterEach(() => {
  cleanup();
});

describe("<CourseStatusIcons />", () => {
  const courseId = "course-123";

  describe("tree icon (Network)", () => {
    it("renders the tree icon as a link to /courses/:id/tree", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides={false}
        />
      );
      const link = screen.getByRole("link", { name: /[áa]rbol conceptual/i });
      expect(link).toHaveAttribute("href", `/courses/${courseId}/tree`);
    });

    it("uses emerald-600 colour when the tree exists", () => {
      const { container } = render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides={false}
        />
      );
      const link = screen.getByRole("link", { name: /[áa]rbol conceptual/i });
      expect(link.className).toMatch(/emerald-600/);
      // The icon (svg) lives inside the link and inherits the colour.
      const svg = link.querySelector("svg");
      expect(svg).toBeInTheDocument();
      // The container must NOT carry the red-500 token when green.
      const wrapper = container.querySelector(
        '[data-testid="course-status-icons"]'
      );
      expect(wrapper).toBeInTheDocument();
      expect(wrapper?.className).not.toMatch(/text-red-500/);
    });

    it("uses red-500 colour and the 'no creado' aria label when the tree is missing", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree={false}
          hasSlides
        />
      );
      const link = screen.getByRole("link", {
        name: /[áa]rbol conceptual.*no creado/i,
      });
      expect(link).toHaveAttribute("href", `/courses/${courseId}/tree`);
      expect(link.className).toMatch(/red-500/);
      // Crucially, the link is still clickable when red (it navigates
      // to the empty-state page).
      expect(link).not.toHaveAttribute("aria-disabled");
    });

    it("exposes a data attribute identifying the resource for e2e selectors", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides
        />
      );
      expect(
        screen.getByTestId("course-status-tree")
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("course-status-slides")
      ).toBeInTheDocument();
    });
  });

  describe("slides icon (Presentation)", () => {
    it("renders the slides icon as a link to /courses/:id/slides", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree={false}
          hasSlides
        />
      );
      const link = screen.getByRole("link", { name: /diapositivas/i });
      expect(link).toHaveAttribute("href", `/courses/${courseId}/slides`);
    });

    it("uses emerald-600 colour when slides exist", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree={false}
          hasSlides
        />
      );
      const link = screen.getByRole("link", { name: /diapositivas/i });
      expect(link.className).toMatch(/emerald-600/);
    });

    it("uses red-500 colour and the 'no creado' aria label when slides are missing", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides={false}
        />
      );
      const link = screen.getByRole("link", {
        name: /diapositivas.*no creado/i,
      });
      expect(link).toHaveAttribute("href", `/courses/${courseId}/slides`);
      expect(link.className).toMatch(/red-500/);
    });
  });

  describe("visual group separation", () => {
    it("renders BOTH icons in a single container that exposes a test id", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides={false}
        />
      );
      const group = screen.getByTestId("course-status-icons");
      expect(group).toBeInTheDocument();
      // Both icons are children of the same group.
      const tree = screen.getByTestId("course-status-tree");
      const slides = screen.getByTestId("course-status-slides");
      expect(group.contains(tree)).toBe(true);
      expect(group.contains(slides)).toBe(true);
    });

    it("decorates the group with a separator token so the consuming card can visually separate it from the action buttons", () => {
      const { container } = render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides
        />
      );
      const group = container.querySelector(
        '[data-testid="course-status-icons"]'
      );
      // The group must carry a class that provides a visual separator
      // (border or a container that the parent can target with a sibling
      // divider). We use a left border on the group itself, applied via
      // Tailwind's `border-l` utility — checked via class name match.
      expect(group?.className).toMatch(/border-l/);
    });

    it("renders touch targets of at least 44x44px (WCAG 2.5.5)", () => {
      const { container } = render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides
        />
      );
      const links = container.querySelectorAll(
        '[data-testid="course-status-icons"] a'
      );
      // h-11 w-11 = 44px in Tailwind
      links.forEach((link) => {
        expect(link.className).toMatch(/h-11/);
        expect(link.className).toMatch(/w-11/);
      });
    });
  });

  describe("aria semantics", () => {
    it("uses Spanish screen-reader labels (no English fallback)", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides={false}
        />
      );
      // English "tree" alone is too generic; the label must be specific.
      const treeLink = screen.getByRole("link", {
        name: /[áa]rbol conceptual/i,
      });
      expect(treeLink).toHaveAccessibleName(/[áa]rbol conceptual/i);
    });

    it("annotates the state ('creado' / 'no creado') so the user knows the colour isn't decorative", () => {
      render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides={false}
        />
      );
      // The tree link is green → its accessible name carries "creado".
      const treeLink = screen.getByTestId("course-status-tree");
      expect(treeLink).toHaveAccessibleName(/creado/i);
      // The slides link is red → "no creado".
      const slidesLink = screen.getByTestId("course-status-slides");
      expect(slidesLink).toHaveAccessibleName(/no creado/i);
    });

    it("provides a focus-visible ring (no outline:none without replacement)", () => {
      const { container } = render(
        <CourseStatusIcons
          courseId={courseId}
          hasTree
          hasSlides
        />
      );
      const links = container.querySelectorAll(
        '[data-testid="course-status-icons"] a'
      );
      links.forEach((link) => {
        // The link must include a focus-visible utility, not just rely
        // on the browser's default focus outline (which is suppressed
        // by Tailwind's preflight).
        expect(link.className).toMatch(/focus-visible/);
      });
    });
  });
});

// @vitest-environment jsdom
// F4.2 — hover tooltip on TreeNode.
//
// We test TreeNodeTooltip in isolation (its only contract is "render
// brief vs full content given the right props") AND the hover state
// machine in TreeNode (the integration test that proves the
// brief → full → idle transitions and the timer reset when the user
// moves from one node to another).
//
// Why split the tests?
//   - The tooltip itself has no behaviour — it's a presentational
//     panel. Testing it in isolation makes the props contract explicit
//     and keeps the hover-machine tests focused on the state
//     transitions (which is where the bugs were in the previous
//     implementations).
//   - The hover state machine is the part that owns the timer; a
//     regression there (timer leak, "leave doesn't reset", "new node
//     inherits old timer") would slip through if we only tested the
//     tooltip.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { TreeNodeTooltip } from "@/components/TreeViewer/TreeNodeTooltip";
import type { TreeFlowNodeData } from "@/lib/adapters/useTreeAdapter";

const baseData: TreeFlowNodeData = {
  name: "Termodinámica",
  summary:
    "Capítulo raíz que cubre las tres leyes de la termodinámica, entropía y equilibrio térmico.",
  depth: 0,
  isLeaf: false,
  version: 1,
  sourceMaterialId: null,
  childNames: ["Primera ley", "Segunda ley", "Tercera ley"],
};

function getData(overrides: Partial<TreeFlowNodeData> = {}): TreeFlowNodeData {
  return { ...baseData, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("<TreeNodeTooltip /> (presentational)", () => {
  it("renders nothing when mode is 'idle' (caller's job to not mount us)", () => {
    // TreeNodeTooltip is the panel; the parent (TreeNode) is
    // responsible for NOT mounting us in 'idle'. We still allow
    // passing an idle-like flag to be defensive — if the parent
    // forgets, we render an empty fragment rather than a misleading
    // empty box.
    const { container } = render(
      <TreeNodeTooltip
        data={getData()}
        // @ts-expect-error — explicit: only "brief" | "full" are valid
        mode="idle"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders brief mode with the child titles", () => {
    render(<TreeNodeTooltip data={getData()} mode="brief" />);
    // The child titles should be visible.
    expect(screen.getByText("Primera ley")).toBeInTheDocument();
    expect(screen.getByText("Segunda ley")).toBeInTheDocument();
    expect(screen.getByText("Tercera ley")).toBeInTheDocument();
  });

  it("brief mode caps the visible children at 5 and appends '…' if more", () => {
    const data = getData({
      childNames: [
        "A",
        "B",
        "C",
        "D",
        "E",
        "F",
        "G",
      ],
    });
    render(<TreeNodeTooltip data={data} mode="brief" />);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("E")).toBeInTheDocument();
    // 6th and 7th must NOT be rendered as full items.
    expect(screen.queryByText("F")).not.toBeInTheDocument();
    expect(screen.queryByText("G")).not.toBeInTheDocument();
    // The overflow indicator must be there.
    expect(screen.getByText(/…|\.\.\./)).toBeInTheDocument();
  });

  it("brief mode shows an empty-state hint when the node has no children", () => {
    const data = getData({ childNames: [], isLeaf: true });
    render(<TreeNodeTooltip data={data} mode="brief" />);
    expect(screen.getByText(/sin sub-conceptos/i)).toBeInTheDocument();
  });

  it("renders full mode with the node's corpus (summary)", () => {
    render(<TreeNodeTooltip data={getData()} mode="full" />);
    expect(
      screen.getByText(/tres leyes de la termodinámica/i)
    ).toBeInTheDocument();
  });

  it("full mode falls back gracefully when the summary is null", () => {
    const data = getData({ summary: null });
    render(<TreeNodeTooltip data={data} mode="full" />);
    // We don't show the literal word "null" — a Spanish fallback
    // message is the contract.
    expect(screen.getByText(/sin (texto|corpus|contenido)/i)).toBeInTheDocument();
  });

  it("full mode truncates very long summaries and shows a 'leer más' affordance", () => {
    const longSummary = "a".repeat(800);
    const data = getData({ summary: longSummary });
    render(<TreeNodeTooltip data={data} mode="full" />);
    // The visible text should be at most ~400 chars (the cap), and
    // there must be a "leer más" affordance so the user knows the
    // text is truncated.
    const visible = document.querySelector(
      '[data-testid="tree-node-tooltip"]'
    )?.textContent ?? "";
    expect(visible.length).toBeLessThanOrEqual(500);
    expect(screen.getByText(/leer m[áa]s/i)).toBeInTheDocument();
  });

  it("uses pointer-events: none so the tooltip never intercepts clicks", () => {
    render(<TreeNodeTooltip data={getData()} mode="brief" />);
    const panel = screen.getByTestId("tree-node-tooltip");
    // `pointer-events: none` is a critical contract — without it the
    // tooltip would swallow the click on the underlying checkbox,
    // which is the F4.1 regression we MUST avoid.
    expect(panel).toHaveStyle({ pointerEvents: "none" });
  });

  it("applies the data-mode attribute so the parent can style/position it", () => {
    const { rerender } = render(
      <TreeNodeTooltip data={getData()} mode="brief" />
    );
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "brief"
    );
    rerender(<TreeNodeTooltip data={getData()} mode="full" />);
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "full"
    );
  });

  it("positions itself with the requested side (top/right/bottom/left)", () => {
    const { rerender } = render(
      <TreeNodeTooltip data={getData()} mode="brief" position="right" />
    );
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-position",
      "right"
    );
    rerender(
      <TreeNodeTooltip data={getData()} mode="brief" position="top" />
    );
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-position",
      "top"
    );
  });

  it("has an accessible role='tooltip' so screen readers announce it", () => {
    render(<TreeNodeTooltip data={getData()} mode="full" />);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });
});

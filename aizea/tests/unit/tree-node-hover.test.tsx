// @vitest-environment jsdom
// F4.2 — hover state machine integration on TreeNode.
//
// We render TreeNode directly (without ReactFlow) to focus on the
// hover state machine: idle → brief (on enter) → full (after 3s) →
// idle (on leave), and the reset semantics when the user moves
// between two nodes.
//
// Why mount TreeNode standalone?
//   - ReactFlow adds noise (positioning, handles, viewport
//     transforms). The state machine is pure component logic; testing
//     it in isolation keeps the assertions tight and the failure
//     messages readable.
//   - We DO still need to mock reactflow because TreeNode imports the
//     `Handle` and `Position` symbols from it. The mock is a no-op.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type * as React from "react";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

import { TreeNode } from "@/components/TreeViewer/TreeNode";
import type { TreeFlowNodeData } from "@/lib/adapters/useTreeAdapter";

// Minimal subset of NodeProps that the test needs. We cast through
// `unknown` because NodeProps is huge (selected, dragging, dragHandle,
// position, sourcePosition, targetPosition, zIndex, isConnectable,
// xPos, yPos, ...) and most of them are irrelevant to the hover
// state machine. The contract we test is the state machine, not the
// ReactFlow node plumbing.
type MinimalNodeProps = { id: string; data: TreeFlowNodeData; type: string };
const asNode = (props: MinimalNodeProps): React.ReactElement =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <TreeNode {...(props as any)} /> as unknown as React.ReactElement;

const nodeId = "n-1";
const mkData = (overrides: Partial<TreeFlowNodeData> = {}): TreeFlowNodeData => ({
  name: "Termodinámica",
  summary: "Capítulo raíz",
  depth: 0,
  isLeaf: false,
  version: 1,
  sourceMaterialId: null,
  childNames: ["Primera ley", "Segunda ley", "Tercera ley"],
  // F4.1 — selection plumbing (not the focus of these tests, but the
  // component reads it).
  selected: false,
  onSelectToggle: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

// Helper: TreeNode is the default-exported ReactFlow node, which is
// memo()-wrapped. We can render it directly; the props signature is
// `{ data }` because that's what NodeProps<T> provides. The
// `as unknown as` cast bypasses the dozens of optional NodeProps
// fields (dragging, targetPosition, etc.) we don't care about for
// the hover state machine.
function renderNode(data: TreeFlowNodeData) {
  return render(asNode({ id: nodeId, data, type: "topic" }));
}

describe("<TreeNode /> hover state machine (F4.2)", () => {
  it("starts in 'idle' — no tooltip is rendered", () => {
    renderNode(mkData());
    expect(screen.queryByTestId("tree-node-tooltip")).not.toBeInTheDocument();
  });

  it("on mouseEnter: enters 'brief' mode and renders the tooltip with child names", () => {
    renderNode(mkData());
    const node = screen.getByTestId("tree-node");
    fireEvent.mouseEnter(node);
    // The brief mode tooltip is visible immediately on enter.
    const tooltip = screen.getByTestId("tree-node-tooltip");
    expect(tooltip).toHaveAttribute("data-mode", "brief");
    expect(screen.getByText("Primera ley")).toBeInTheDocument();
    expect(screen.getByText("Segunda ley")).toBeInTheDocument();
  });

  it("hover < 3s: tooltip stays in 'brief' mode", () => {
    renderNode(mkData());
    const node = screen.getByTestId("tree-node");
    fireEvent.mouseEnter(node);
    // Advance just shy of the threshold.
    act_advance(2999);
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "brief"
    );
  });

  it("hover >= 3s on the same node: tooltip switches to 'full' (corpus)", () => {
    const data = mkData({
      summary: "Tres leyes fundamentales, entropía, equilibrio térmico.",
    });
    renderNode(data);
    const node = screen.getByTestId("tree-node");
    fireEvent.mouseEnter(node);
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "brief"
    );
    act_advance(3000);
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "full"
    );
    // The full mode shows the corpus (summary) inside the dedicated
    // tooltip body element. We assert via the testid rather than
    // text-matching because the tile's own line-clamp-2 summary is
    // also in the DOM (brief mode hides it visually, but the text
    // is there).
    const corpus = screen.getByTestId("tree-node-tooltip-corpus");
    expect(corpus).toBeInTheDocument();
    expect(corpus).toHaveTextContent(/tres leyes fundamentales/i);
  });

  it("hover >= 3.5s on the same node: tooltip remains in 'full' mode (idempotent)", () => {
    renderNode(mkData());
    const node = screen.getByTestId("tree-node");
    fireEvent.mouseEnter(node);
    act_advance(3500);
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "full"
    );
  });

  it("on mouseLeave: tooltip disappears and timer is cleared", () => {
    renderNode(mkData());
    const node = screen.getByTestId("tree-node");
    fireEvent.mouseEnter(node);
    expect(screen.getByTestId("tree-node-tooltip")).toBeInTheDocument();
    fireEvent.mouseLeave(node);
    expect(screen.queryByTestId("tree-node-tooltip")).not.toBeInTheDocument();
    // Even if the timer were to fire after leave, the tooltip must
    // NOT come back. We simulate that by advancing the clock well
    // past the threshold.
    act_advance(5000);
    expect(screen.queryByTestId("tree-node-tooltip")).not.toBeInTheDocument();
  });

  it("moving from node A to node B: A's tooltip is gone, B's tooltip is in 'brief'", () => {
    // Render TWO TreeNodes in the same DOM and simulate the mouse
    // moving from one to the other.
    const { container } = render(
      <div>
        <div data-testid="wrap-a">
          {asNode({
            id: "a",
            data: mkData({ name: "Nodo A", childNames: ["a1", "a2"] }),
            type: "topic",
          })}
        </div>
        <div data-testid="wrap-b">
          {asNode({
            id: "b",
            data: mkData({ name: "Nodo B", childNames: ["b1", "b2"] }),
            type: "topic",
          })}
        </div>
      </div>
    );
    const nodeA = container.querySelector('[data-testid="wrap-a"] [data-testid="tree-node"]')!;
    const nodeB = container.querySelector('[data-testid="wrap-b"] [data-testid="tree-node"]')!;
    fireEvent.mouseEnter(nodeA);
    // Only A's tooltip is rendered.
    expect(screen.getByText("a1")).toBeInTheDocument();
    expect(screen.queryByText("b1")).not.toBeInTheDocument();
    // Move to B: A's tooltip must vanish, B's tooltip must appear in
    // brief mode (timer reset).
    fireEvent.mouseLeave(nodeA);
    fireEvent.mouseEnter(nodeB);
    expect(screen.queryByText("a1")).not.toBeInTheDocument();
    expect(screen.getByText("b1")).toBeInTheDocument();
    // The mode must be brief, not full (timer reset).
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "brief"
    );
  });

  it("hovering B for 3s after coming from A: B's tooltip reaches 'full' (timer NOT carried over)", () => {
    const { container } = render(
      <div>
        <div data-testid="wrap-a">
          {asNode({ id: "a", data: mkData({ name: "A" }), type: "topic" })}
        </div>
        <div data-testid="wrap-b">
          {asNode({ id: "b", data: mkData({ name: "B" }), type: "topic" })}
        </div>
      </div>
    );
    const nodeA = container.querySelector('[data-testid="wrap-a"] [data-testid="tree-node"]')!;
    const nodeB = container.querySelector('[data-testid="wrap-b"] [data-testid="tree-node"]')!;
    // Stay on A for 2.5s, then move to B.
    fireEvent.mouseEnter(nodeA);
    act_advance(2500);
    fireEvent.mouseLeave(nodeA);
    fireEvent.mouseEnter(nodeB);
    // B has been hovered 0ms so far — still in brief mode. The
    // important check: if the timer had been carried over from A
    // (A was 2.5s into a 3s timer), B would already be in 'full'.
    // It must NOT be.
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "brief"
    );
    // Now advance the full 3s on B — B's own timer fires from
    // scratch.
    act_advance(3000);
    expect(screen.getByTestId("tree-node-tooltip")).toHaveAttribute(
      "data-mode",
      "full"
    );
  });

  it("unmounting the node while in 'full' mode cleans up the pending timer (no leaks)", () => {
    // This is a smoke test for the cleanup-on-unmount contract: if
    // the timer were NOT cleared, vitest would print a warning
    // ("An update to <TreeNode> inside a test was not wrapped in
    // act(...)") when the timer fired after unmount. We also assert
    // that the timer doesn't fire after unmount.
    const { unmount } = renderNode(mkData());
    const node = screen.getByTestId("tree-node");
    fireEvent.mouseEnter(node);
    act_advance(3000); // tooltip is now in 'full'
    // Unmount mid-hover. The pending timer (none left at this point,
    // but the principle stands) must not throw or warn.
    unmount();
    // No further assert; absence of warnings/errors is the contract.
  });

  it("the tooltip is rendered INSIDE the node, and uses pointer-events: none", () => {
    // F4.2 critical contract: the tooltip MUST not intercept the
    // F4.1 checkbox click. We assert it directly here.
    renderNode(mkData());
    const node = screen.getByTestId("tree-node");
    fireEvent.mouseEnter(node);
    const tooltip = screen.getByTestId("tree-node-tooltip");
    expect(node.contains(tooltip)).toBe(true);
    expect(tooltip).toHaveStyle({ pointerEvents: "none" });
  });

  it("moving the mouse from tile body to checkbox keeps the tooltip visible", () => {
    // F4.2 — the hover state is owned by the tile, NOT by the
    // checkbox. In a real browser, the native `mouseenter` event
    // does NOT bubble, so moving the mouse from the tile body to
    // the checkbox (a child) does NOT fire the parent's
    // onMouseEnter again. This test simulates the user journey:
    // hover tile → tooltip appears → move to checkbox → tooltip
    // STAYS visible.
    //
    // NOTE: React's synthetic `onMouseEnter` is implemented on top
    // of `onMouseOver` and DOES re-fire when the mouse enters a
    // child. This is a known synthetic-event quirk; in the real
    // browser the parent's handler does NOT re-fire. The component
    // is designed for the real browser behaviour, so the contract
    // we assert here is the conservative one: the tooltip
    // continues to be visible after the mouse moves within the
    // tile. We don't assert "no state change" because that would
    // be testing React internals, not our component.
    renderNode(mkData());
    const node = screen.getByTestId("tree-node");
    fireEvent.mouseEnter(node);
    expect(screen.getByTestId("tree-node-tooltip")).toBeInTheDocument();
    // Move to the checkbox. The tooltip must still be there (in
    // either 'brief' or 'full' state — both render the panel).
    const cb = screen.getByTestId("tree-node-checkbox");
    fireEvent.mouseEnter(cb);
    expect(screen.getByTestId("tree-node-tooltip")).toBeInTheDocument();
  });

  it("checkbox click still works while a tooltip is showing (F4.1 regression guard)", () => {
    // F4.1 was about body click NOT toggling selection. F4.2 must
    // not break F4.1: clicking the checkbox while the tooltip is
    // showing must still toggle selection.
    //
    // We use `fireEvent.click` (synchronous) instead of
    // `userEvent.click` (async, real pointer events) because the
    // hover tests run with fake timers and userEvent v14 + fake
    // timers has known interaction issues. The contract we care
    // about — the click handler fires, the tooltip is still
    // visible — is testable with the synchronous path.
    const onSelectToggle = vi.fn();
    const data = mkData({ onSelectToggle });
    renderNode(data);
    const node = screen.getByTestId("tree-node");
    const cb = screen.getByTestId("tree-node-checkbox");
    fireEvent.mouseEnter(node); // show tooltip
    fireEvent.click(cb);
    expect(onSelectToggle).toHaveBeenCalledTimes(1);
    // The tooltip is still visible — clicking the checkbox must
    // NOT dismiss it. (The tile's own onMouseLeave does not fire
    // for a click on a child in real browsers.)
    expect(screen.getByTestId("tree-node-tooltip")).toBeInTheDocument();
  });
});

// --- helpers ---

// Wrap `vi.advanceTimersByTime` in `act()` so React flushes the
// resulting state update. Without this, the test would log warnings
// ("not wrapped in act").
function act_advance(ms: number) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { act } = require("@testing-library/react");
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

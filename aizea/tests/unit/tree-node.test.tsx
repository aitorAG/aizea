// @vitest-environment jsdom
//
// F4.5 — visual treatment of the "pending" state on TreeNode.
//
// We render TreeNode directly (without ReactFlow) so the visual
// assertion is tight: when `data.pending` is true the tile gets a
// `data-pending="true"` attribute, the `animate-pulse` class, and
// the `opacity-60` class. When it is false (or undefined) the
// pending markers are absent.
//
// Why mount TreeNode standalone?
//   - ReactFlow adds noise (positioning, handles, viewport
//     transforms). The visual treatment is pure component logic;
//     testing it in isolation keeps the assertions tight and the
//     failure messages readable.
//   - We DO still need to mock reactflow because TreeNode imports
//     the `Handle` and `Position` symbols from it. The mock is a
//     no-op (matches the pattern in tree-node-hover.test.tsx).

import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type * as React from "react";

vi.mock("reactflow", () => ({
  Handle: () => null,
  Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
}));

import { TreeNode } from "@/components/TreeViewer/TreeNode";
import type { TreeFlowNodeData } from "@/lib/adapters/useTreeAdapter";

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
  childNames: ["Primera ley", "Segunda ley"],
  selected: false,
  onSelectToggle: vi.fn(),
  ...overrides,
});

afterEach(() => {
  cleanup();
});

function renderNode(data: TreeFlowNodeData) {
  return render(asNode({ id: nodeId, data, type: "topic" }));
}

describe("<TreeNode /> pending visual (F4.5)", () => {
  it("renders with data-pending='false' by default", () => {
    renderNode(mkData());
    const node = screen.getByTestId("tree-node");
    expect(node).toHaveAttribute("data-pending", "false");
  });

  it("renders with data-pending='false' when data.pending is explicitly false", () => {
    renderNode(mkData({ pending: false }));
    const node = screen.getByTestId("tree-node");
    expect(node).toHaveAttribute("data-pending", "false");
  });

  it("renders with data-pending='true' when data.pending is true", () => {
    renderNode(mkData({ pending: true }));
    const node = screen.getByTestId("tree-node");
    expect(node).toHaveAttribute("data-pending", "true");
  });

  it("applies the 'animate-pulse' class when pending", () => {
    renderNode(mkData({ pending: true }));
    const node = screen.getByTestId("tree-node");
    expect(node.className).toMatch(/animate-pulse/);
  });

  it("applies the 'opacity-60' class when pending", () => {
    renderNode(mkData({ pending: true }));
    const node = screen.getByTestId("tree-node");
    expect(node.className).toMatch(/opacity-60/);
  });

  it("does NOT apply animate-pulse or opacity-60 when NOT pending", () => {
    renderNode(mkData({ pending: false }));
    const node = screen.getByTestId("tree-node");
    expect(node.className).not.toMatch(/animate-pulse/);
    expect(node.className).not.toMatch(/opacity-60/);
  });

  it("does NOT apply animate-pulse or opacity-60 when pending is undefined", () => {
    // The default for `data.pending` is undefined. Make sure we
    // don't accidentally treat that as "pending" (the bug
    // would be the inverse: a permanent dim on every node).
    // We omit the `pending` key entirely from the data object
    // to exercise the `data.pending === true` guard rather than
    // the `data.pending === false` guard.
    const data = mkData();
    delete data.pending;
    renderNode(data);
    const node = screen.getByTestId("tree-node");
    expect(node).toHaveAttribute("data-pending", "false");
    expect(node.className).not.toMatch(/animate-pulse/);
    expect(node.className).not.toMatch(/opacity-60/);
  });

  it("keeps the checkbox enabled when pending (the user can still select/deselect)", () => {
    // The F4.5 spec: "Don't disable the checkbox". Verify the
    // checkbox is rendered with the right `aria-checked` and
    // isn't disabled while the node is in flight.
    renderNode(mkData({ pending: true, selected: false }));
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toHaveAttribute("aria-checked", "false");
    expect(checkbox).not.toBeDisabled();
  });

  it("keeps the selected AND pending axes independent (selecting a pending node still works)", () => {
    renderNode(mkData({ pending: true, selected: true }));
    const node = screen.getByTestId("tree-node");
    expect(node).toHaveAttribute("data-pending", "true");
    expect(node).toHaveAttribute("data-selected", "true");
    // Both visual treatments can stack — pending still pulses
    // even when the ring/selected treatment is applied.
    expect(node.className).toMatch(/animate-pulse/);
  });
});

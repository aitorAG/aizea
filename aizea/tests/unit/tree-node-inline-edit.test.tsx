// @vitest-environment jsdom
//
// TreeNode — inline-edit mode for freshly-created nodes.
//
// What is tested:
//   - When `data.isNew` is true, the static name + summary is
//     REPLACED by the InlineTreeNodeEditor
//   - When `data.isNew` is true, the outer div has
//     `data-is-new="true"`
//   - When `data.isNew` is false, the editor is NOT rendered
//   - When `data.isNew` is false, the static name + summary is
//     rendered as before (F4.2 / F4.1 contract)
//   - The "Nuevo" badge is rendered when isNew
//   - The inline editor's onSave fires the parent-supplied
//     `data.onSaveInlineEdit` callback
//   - The inline editor's input events do NOT propagate to the
//     parent (regression guard for F4.1 body-click selection)

import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

afterEach(() => {
  cleanup();
});

const baseData = (
  overrides: Partial<TreeFlowNodeData> = {}
): TreeFlowNodeData => ({
  name: "Termodinámica",
  summary: "Capítulo raíz",
  depth: 0,
  isLeaf: false,
  version: 1,
  sourceMaterialId: null,
  childNames: ["Primera ley"],
  selected: false,
  onSelectToggle: vi.fn(),
  ...overrides,
});

function renderNode(data: TreeFlowNodeData) {
  return render(asNode({ id: "n-1", data, type: "topic" }));
}

describe("<TreeNode /> — inline edit mode (isNew)", () => {
  it("isNew=true: renders the inline editor instead of the static name", () => {
    renderNode(baseData({ isNew: true, name: "Nuevo nodo", summary: null }));
    // The static name + summary text is NOT rendered.
    expect(screen.queryByTestId("tree-node-name")).not.toBeInTheDocument();
    // The inline editor IS rendered.
    expect(
      screen.getByTestId("inline-tree-node-editor")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inline-tree-node-name-input")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("inline-tree-node-summary-input")
    ).toBeInTheDocument();
  });

  it("isNew=true: sets data-is-new='true' on the outer tile", () => {
    renderNode(baseData({ isNew: true }));
    const node = screen.getByTestId("tree-node");
    expect(node).toHaveAttribute("data-is-new", "true");
  });

  it("isNew=false: does NOT render the inline editor", () => {
    renderNode(baseData({ isNew: false }));
    expect(
      screen.queryByTestId("inline-tree-node-editor")
    ).not.toBeInTheDocument();
    // The static name IS rendered.
    expect(screen.getByTestId("tree-node-name")).toBeInTheDocument();
  });

  it("isNew omitted (undefined): does NOT render the inline editor", () => {
    renderNode(baseData({ isNew: undefined }));
    expect(
      screen.queryByTestId("inline-tree-node-editor")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("tree-node-name")).toBeInTheDocument();
  });

  it("isNew=false: sets data-is-new='false' on the outer tile", () => {
    renderNode(baseData({ isNew: false }));
    const node = screen.getByTestId("tree-node");
    expect(node).toHaveAttribute("data-is-new", "false");
  });

  it("isNew=true: shows a 'Nuevo' badge", () => {
    renderNode(baseData({ isNew: true }));
    expect(screen.getByTestId("tree-node-new-badge")).toBeInTheDocument();
  });

  it("isNew=false: does NOT show a 'Nuevo' badge", () => {
    renderNode(baseData({ isNew: false }));
    expect(
      screen.queryByTestId("tree-node-new-badge")
    ).not.toBeInTheDocument();
  });

  it("isNew=true: typing in the editor and pressing Enter fires onSaveInlineEdit", async () => {
    const onSaveInlineEdit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderNode(
      baseData({
        isNew: true,
        name: "Nuevo nodo",
        summary: null,
        onSaveInlineEdit,
      })
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await user.click(summaryInput);
    await user.type(summaryInput, "Leyes de Newton");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(onSaveInlineEdit).toHaveBeenCalled();
    });
    expect(onSaveInlineEdit).toHaveBeenLastCalledWith({
      name: "Nuevo nodo",
      summary: "Leyes de Newton",
    });
  });

  it("isNew=true: clicking inside the editor does NOT toggle selection (F4.1 regression guard)", async () => {
    const onSelectToggle = vi.fn();
    renderNode(
      baseData({
        isNew: true,
        name: "Nuevo nodo",
        summary: null,
        onSelectToggle,
      })
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    await userEvent.click(summaryInput);
    expect(onSelectToggle).not.toHaveBeenCalled();
  });

  it("isNew=true: does NOT render the leaf/branch icon next to the editor (replaced by the editor)", () => {
    // The leaf/branch icon is rendered as a span with title="Hoja"
    // or title="Rama". When the editor is mounted, the icon
    // should not be present (the editor is its own "label").
    renderNode(
      baseData({ isNew: true, isLeaf: false, name: "Nuevo nodo", summary: null })
    );
    expect(screen.queryByTitle("Rama")).not.toBeInTheDocument();
  });

  it("isNew=true: pre-fills the name input with the current node name", () => {
    renderNode(
      baseData({ isNew: true, name: "Capítulo A", summary: null })
    );
    const nameInput = screen.getByTestId("inline-tree-node-name-input");
    expect(nameInput).toHaveValue("Capítulo A");
  });

  it("isNew=true: pre-fills the description input with the current summary", () => {
    renderNode(
      baseData({ isNew: true, name: "X", summary: "Resumen previo" })
    );
    const summaryInput = screen.getByTestId("inline-tree-node-summary-input");
    expect(summaryInput).toHaveValue("Resumen previo");
  });
});

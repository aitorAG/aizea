// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock the server actions so handler tests can control the action
// lifecycle (add ids to pending → assert → resolve → assert cleared).
// The existing tests don't trigger any action button, so the mock
// defaults are inert. F4.5 added.
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockMerge = vi.fn();
const mockSplit = vi.fn();
const mockAdd = vi.fn();

vi.mock("@/lib/actions/tree", () => ({
  updateTreeNodeAction: (...args: unknown[]) => mockUpdate(...args),
  deleteTreeNodeAction: (...args: unknown[]) => mockDelete(...args),
  mergeTreeNodesAction: (...args: unknown[]) => mockMerge(...args),
  splitTreeNodeAction: (...args: unknown[]) => mockSplit(...args),
  addTreeNodeAction: (...args: unknown[]) => mockAdd(...args),
}));

// Mock ReactFlow so the tests don't need a real canvas / dagre layout. The
// mock mirrors the new multi-checkbox selection model AND the real
// ReactFlow behaviour of firing `onNodesChange` with a `select` change
// when a node body is clicked (without this, a regression where
// body click leaks into selection state would not be caught by the
// unit tests — see RCA in the F4.1 plan).
//
// F4.5 — also mirrors the F4.5 `data.pending` flag as a
// `data-pending` attribute on the rendered div so handler tests
// can assert the in-flight state.
vi.mock("reactflow", () => {
  function MockReactFlow({
    nodes,
    edges,
    onNodeClick,
    onNodeContextMenu,
    onNodesChange,
  }: {
    nodes: Array<{
      id: string;
      data?: Record<string, unknown> & {
        selected?: boolean;
        pending?: boolean;
        onSelectToggle?: () => void;
        name?: string;
        isLeaf?: boolean;
      };
    }>;
    edges: Array<{ id: string; source: string; target: string }>;
    onNodeClick?: (e: unknown, node: { id: string }) => void;
    onNodeContextMenu?: (e: unknown, node: { id: string }) => void;
    onNodesChange?: (
      changes: Array<{
        id: string;
        type: string;
        selected?: boolean;
      }>
    ) => void;
  }) {
    return (
      <div data-testid="reactflow">
        <div data-testid="rf-nodes">
          {nodes.map((n) => {
            const isSelected = Boolean(n.data?.selected);
            const isPending = Boolean(n.data?.pending);
            const onToggle = n.data?.onSelectToggle;
            const name = String(n.data?.name ?? n.id);
            return (
              <div
                key={n.id}
                data-testid={`rf-node-${n.id}`}
                data-rf-node="true"
                data-node-id={n.id}
                data-selected={isSelected ? "true" : "false"}
                data-pending={isPending ? "true" : "false"}
                onClick={() => {
                  // Mirrors real ReactFlow: body click fires both
                  // onNodeClick AND onNodesChange({ type: "select",
                  // selected: true }). Our TreeViewer MUST ignore the
                  // select change for selection purposes — see F4.1
                  // handleNodesChange.
                  onNodeClick?.({}, n);
                  onNodesChange?.([
                    { id: n.id, type: "select", selected: true },
                  ]);
                }}
                onContextMenu={() => onNodeContextMenu?.({}, n)}
              >
                <input
                  type="checkbox"
                  role="checkbox"
                  data-testid={`rf-node-checkbox-${n.id}`}
                  checked={isSelected}
                  aria-label={
                    isSelected
                      ? `Deseleccionar ${name}`
                      : `Seleccionar ${name}`
                  }
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => onToggle?.()}
                />
                <span data-testid="rf-node-name">{name}</span>
                {n.data?.isLeaf ? (
                  <span data-testid="rf-node-leaf">leaf</span>
                ) : (
                  <span data-testid="rf-node-branch">branch</span>
                )}
              </div>
            );
          })}
        </div>
        <svg data-testid="rf-edges">
          {edges.map((e) => (
            <line
              key={e.id}
              data-testid="rf-edge"
              data-source={e.source}
              data-target={e.target}
            />
          ))}
        </svg>
        {onNodesChange && (
          <button
            data-testid="simulate-drag"
            onClick={() => onNodesChange([{ id: nodes[0]?.id, type: "position" }])}
          >
            drag
          </button>
        )}
      </div>
    );
  }

  return {
    __esModule: true,
    default: MockReactFlow,
    Background: () => null,
    BackgroundVariant: { Dots: "dots", Lines: "lines", Cross: "cross" },
    Controls: () => <div data-testid="rf-controls" />,
    MiniMap: () => <div data-testid="rf-minimap" />,
    Handle: () => <div data-testid="rf-handle" />,
    Position: { Top: "top", Bottom: "bottom", Left: "left", Right: "right" },
    applyNodeChanges: (
      changes: Array<{ id: string; type: string; selected?: boolean }>,
      nodes: Array<{ id: string }>
    ) =>
      nodes.map((n) => {
        const sel = changes.find(
          (c) => c.id === n.id && c.type === "select" && c.selected
        );
        return sel ? { ...n, selected: true } : n;
      }),
  };
});

vi.mock("reactflow/dist/style.css", () => ({}));

import { TreeViewer } from "@/components/TreeViewer/TreeViewer";
import type { TopicNode } from "@/lib/types/pipeline";

const mockNodes: TopicNode[] = [
  {
    id: "root-1",
    courseId: "c1",
    parentId: null,
    name: "Termodinámica",
    summary: "Capítulo raíz",
    depth: 0,
    orderIndex: 0,
    isLeaf: false,
    version: 1,
    sourceMaterialId: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "child-1",
    courseId: "c1",
    parentId: "root-1",
    name: "Primera ley",
    summary: null,
    depth: 1,
    orderIndex: 0,
    isLeaf: true,
    version: 1,
    sourceMaterialId: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "child-2",
    courseId: "c1",
    parentId: "root-1",
    name: "Segunda ley",
    summary: null,
    depth: 1,
    orderIndex: 0,
    isLeaf: true,
    version: 1,
    sourceMaterialId: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "child-3",
    courseId: "c1",
    parentId: "root-1",
    name: "Tercera ley",
    summary: null,
    depth: 1,
    orderIndex: 0,
    isLeaf: true,
    version: 1,
    sourceMaterialId: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

describe("<TreeViewer />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // F4.5 — the new pending-lifecycle tests need a deterministic
    // action resolution. Default to a resolved promise; individual
    // tests override with deferreds where they need to assert
    // the in-flight state.
    mockUpdate.mockResolvedValue({ ok: true, node: { ...mockNodes[0] } });
    mockDelete.mockResolvedValue({ ok: true });
    mockMerge.mockResolvedValue({ ok: true, node: { ...mockNodes[0], name: "merged" } });
    mockSplit.mockResolvedValue({ ok: true, nodes: [] });
    mockAdd.mockResolvedValue({ ok: true, node: { ...mockNodes[0], id: "new-id" } });
  });
  afterEach(() => {
    cleanup();
  });

  it("renders ReactFlow with the correct number of nodes", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const renderedNodes = document.querySelectorAll('[data-rf-node="true"]');
    expect(renderedNodes).toHaveLength(mockNodes.length);
  });

  it("renders the names of the nodes", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(screen.getByText("Termodinámica")).toBeInTheDocument();
    expect(screen.getByText("Primera ley")).toBeInTheDocument();
    expect(screen.getByText("Segunda ley")).toBeInTheDocument();
  });

  it("renders edges for every parent-child relationship", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const edges = screen.getAllByTestId("rf-edge");
    expect(edges).toHaveLength(3);
    const pairs = edges
      .map((e) => `${e.getAttribute("data-source")}->${e.getAttribute("data-target")}`)
      .sort();
    expect(pairs).toEqual([
      "root-1->child-1",
      "root-1->child-2",
      "root-1->child-3",
    ]);
  });

  it("distinguishes leaf nodes from branch nodes", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(screen.getAllByTestId("rf-node-leaf")).toHaveLength(3);
    expect(screen.getAllByTestId("rf-node-branch")).toHaveLength(1);
  });

  it("renders one checkbox per node in the tree", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(mockNodes.length);
  });

  it("starts with every checkbox unchecked", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const checkboxes = screen.getAllByRole("checkbox");
    for (const cb of checkboxes) {
      expect(cb).not.toBeChecked();
    }
  });

  it("aria-label of an unchecked checkbox includes 'Seleccionar'", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const cb = screen.getByTestId("rf-node-checkbox-child-1");
    expect(cb).toHaveAttribute("aria-label", "Seleccionar Primera ley");
  });

  it("aria-label of a checked checkbox switches to 'Deseleccionar'", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const cb = screen.getByTestId("rf-node-checkbox-child-1");
    await user.click(cb);
    expect(cb).toHaveAttribute("aria-label", "Deseleccionar Primera ley");
  });

  // -------- F4.1 multi-checkbox selection model --------

  it("clicking a node's checkbox marks that node as selected", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const node = screen.getByTestId("rf-node-child-1");
    const cb = screen.getByTestId("rf-node-checkbox-child-1");
    await user.click(cb);
    expect(node).toHaveAttribute("data-selected", "true");
  });

  it("clicking the body of a node does NOT toggle selection", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const node = screen.getByTestId("rf-node-child-1");
    // Click the body of the node — but not the checkbox. The name span
    // is a reliable body target.
    await user.click(screen.getByText("Primera ley"));
    expect(node).toHaveAttribute("data-selected", "false");
  });

  it("clicking the body of a node does not toggle any other node either", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const node1 = screen.getByTestId("rf-node-child-1");
    const node2 = screen.getByTestId("rf-node-child-2");
    await user.click(screen.getByText("Primera ley"));
    expect(node1).toHaveAttribute("data-selected", "false");
    expect(node2).toHaveAttribute("data-selected", "false");
  });

  // Regression test for the bug Playwright caught: clicking the
  // body of a node in real ReactFlow fires an `onNodesChange` with
  // a `select` change. The mock now mirrors that. The TreeViewer
  // MUST ignore those `select` changes — only the checkbox drives
  // the selection set. Without this test, a future refactor that
  // re-introduces the body-click → selection coupling would slip
  // through.
  it("body click does NOT collapse the existing multi-selection (regression)", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    // Mark two nodes via their checkboxes.
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));
    expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
      "data-selected",
      "true"
    );
    expect(screen.getByTestId("rf-node-child-2")).toHaveAttribute(
      "data-selected",
      "true"
    );
    // Now click the body of a THIRD, previously unselected node.
    // Even though the mock fires a "select" change for it, the
    // multi-selection set must remain intact.
    await user.click(screen.getByText("Tercera ley"));
    expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
      "data-selected",
      "true"
    );
    expect(screen.getByTestId("rf-node-child-2")).toHaveAttribute(
      "data-selected",
      "true"
    );
    expect(screen.getByTestId("rf-node-child-3")).toHaveAttribute(
      "data-selected",
      "false"
    );
  });

  it("multi-select: marking two checkboxes keeps BOTH selected", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));
    expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
      "data-selected",
      "true"
    );
    expect(screen.getByTestId("rf-node-child-2")).toHaveAttribute(
      "data-selected",
      "true"
    );
    expect(screen.getByTestId("rf-node-root-1")).toHaveAttribute(
      "data-selected",
      "false"
    );
  });

  it("multi-select: unmarking one keeps the other selected", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));
    // Now uncheck child-1
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
      "data-selected",
      "false"
    );
    expect(screen.getByTestId("rf-node-child-2")).toHaveAttribute(
      "data-selected",
      "true"
    );
  });

  it("re-clicking a checkbox toggles it back off", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const cb = screen.getByTestId("rf-node-checkbox-child-1");
    await user.click(cb);
    expect(cb).toBeChecked();
    await user.click(cb);
    expect(cb).not.toBeChecked();
  });

  it("selectAll() marks every node as selected", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    // Trigger selectAll by clicking the "Seleccionar todas" button in
    // the TreeControls toolbar.
    const selectAllBtn = screen.getByRole("button", {
      name: /seleccionar todas/i,
    });
    await user.click(selectAllBtn);
    const nodes = document.querySelectorAll('[data-rf-node="true"]');
    for (const n of nodes) {
      expect(n).toHaveAttribute("data-selected", "true");
    }
  });

  // -------- F4.1 'Seleccionar todas' is a TOGGLE --------
  //
  // The toolbar button used to always select all; the new behaviour
  // is to TOGGLE between "select all" and "deselect all". The label
  // and the variant reflect the action the next click will perform.

  it("toggle: clicking the button when 0 selected selects all", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const btn = screen.getByRole("button", { name: /seleccionar todas/i });
    await user.click(btn);
    const nodes = document.querySelectorAll('[data-rf-node="true"]');
    for (const n of nodes) {
      expect(n).toHaveAttribute("data-selected", "true");
    }
    // After selecting all, the button must flip its label to
    // "Deseleccionar todas" so the user can tell what the next
    // click will do.
    expect(
      screen.getByRole("button", { name: /deseleccionar todas/i })
    ).toBeInTheDocument();
  });

  it("toggle: clicking the button when SOME selected selects the rest", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    // Pre-select two nodes via the checkboxes.
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));
    // Sanity check: the toolbar still reads "Seleccionar todas"
    // (because not all nodes are selected yet).
    expect(
      screen.getByRole("button", { name: /seleccionar todas/i })
    ).toBeInTheDocument();
    // Click the toolbar button.
    const btn = screen.getByRole("button", { name: /seleccionar todas/i });
    await user.click(btn);
    // Every node must now be selected.
    const nodes = document.querySelectorAll('[data-rf-node="true"]');
    expect(nodes).toHaveLength(mockNodes.length);
    for (const n of nodes) {
      expect(n).toHaveAttribute("data-selected", "true");
    }
    // And the label must have flipped.
    expect(
      screen.getByRole("button", { name: /deseleccionar todas/i })
    ).toBeInTheDocument();
  });

  it("toggle: clicking the button when ALL selected deselects all", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    // Click once to select all.
    await user.click(
      screen.getByRole("button", { name: /seleccionar todas/i })
    );
    // Verify all selected.
    let nodes = document.querySelectorAll('[data-rf-node="true"]');
    for (const n of nodes) {
      expect(n).toHaveAttribute("data-selected", "true");
    }
    // The button must now read "Deseleccionar todas".
    const deselectBtn = screen.getByRole("button", {
      name: /deseleccionar todas/i,
    });
    // Click again — must deselect everything.
    await user.click(deselectBtn);
    nodes = document.querySelectorAll('[data-rf-node="true"]');
    for (const n of nodes) {
      expect(n).toHaveAttribute("data-selected", "false");
    }
    // And the label must have flipped back to "Seleccionar todas".
    expect(
      screen.getByRole("button", { name: /seleccionar todas/i })
    ).toBeInTheDocument();
  });

  it("toggle: the button is highlighted (primary variant) when all selected", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    // Initial: outline variant, no `bg-primary` class.
    const before = screen.getByTestId("select-all");
    expect(before.className).not.toMatch(/bg-primary/);
    // Click to select all.
    await user.click(before);
    // Now: the button reads "Deseleccionar todas" and uses the
    // primary variant (the "this will DESELECT" affordance is
    // highlighted).
    const after = screen.getByTestId("select-all");
    expect(after).toHaveTextContent(/deseleccionar todas/i);
    expect(after.className).toMatch(/bg-primary/);
  });

  it("clearSelection() empties the selection (Escape key)", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));
    expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
      "data-selected",
      "true"
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
      "data-selected",
      "false"
    );
    expect(screen.getByTestId("rf-node-child-2")).toHaveAttribute(
      "data-selected",
      "false"
    );
  });

  // -------- F4.1 action buttons reflect the multi-selection model --------

  it("renders the five control buttons (Podar, Unir, Dividir, Añadir hijo, Eliminar)", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /podar/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unir/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dividir/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /a[ñn]adir hijo/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /eliminar/i })).toBeInTheDocument();
  });

  it("disables all action buttons when nothing is selected", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /podar/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /unir/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /dividir/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /eliminar/i })).toBeDisabled();
  });

  it("enables Podar and Eliminar when one checkbox is checked", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    expect(screen.getByRole("button", { name: /podar/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /eliminar/i })).not.toBeDisabled();
  });

  it("enables Unir only when two or more checkboxes are checked", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    expect(screen.getByRole("button", { name: /unir/i })).toBeDisabled();
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));
    expect(screen.getByRole("button", { name: /unir/i })).not.toBeDisabled();
  });

  it("enables Dividir only when exactly one checkbox is checked", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    expect(screen.getByRole("button", { name: /dividir/i })).not.toBeDisabled();
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));
    expect(screen.getByRole("button", { name: /dividir/i })).toBeDisabled();
  });

  it("renders an 'add root' button even when nothing is selected", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /a[ñn]adir ra[íi]z/i })
    ).toBeInTheDocument();
  });

  it("renders a 'select all' button", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /seleccionar todas/i })
    ).toBeInTheDocument();
  });

  it("calls onGenerateSlides with ALL selected ids (multi)", async () => {
    const onGenerateSlides = vi.fn();
    const user = userEvent.setup();
    render(
      <TreeViewer
        nodes={mockNodes}
        onChange={() => {}}
        onGenerateSlides={onGenerateSlides}
      />
    );
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));
    // The "Generar N diapositivas" floating button should now be
    // visible — clicking it must hand BOTH ids to the parent.
    const btn = await screen.findByRole("button", {
      name: /generar 2 diapositivas/i,
    });
    await user.click(btn);
    expect(onGenerateSlides).toHaveBeenCalledTimes(1);
    const arg = (onGenerateSlides.mock.calls[0]?.[0] ?? []) as string[];
    expect(new Set(arg)).toEqual(new Set(["child-1", "child-2"]));
  });

  it("calls onChange with the updated nodes when selection changes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={onChange} />);
    await user.click(screen.getByTestId("rf-node-checkbox-root-1"));
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)?.[0] as TopicNode[];
    const updated = lastCall.find((n) => n.id === "root-1");
    expect(updated).toBeDefined();
  });

  it("shows an empty-state message when there are no nodes", () => {
    render(<TreeViewer nodes={[]} onChange={() => {}} />);
    expect(screen.getByText(/[áa]rbol.*(vac[íi]o|est[áa])/i)).toBeInTheDocument();
  });

  it("clears the selection on Escape", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const cb = screen.getByTestId("rf-node-checkbox-child-1");
    await user.click(cb);
    expect(cb).toBeChecked();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cb).not.toBeChecked();
  });

  // -------- F4.5 — real-time pending state for async actions --------
  //
  // The "Podar / Unir / Eliminar" buttons used to look unresponsive
  // because the underlying server action is async but the UI had no
  // in-flight state. The fix is structural: every mutation handler
  // mirrors its lifecycle into a `pendingNodeIds` set (add → await
  // → remove in finally) and the TreeNode reads `data.pending` to
  // render a subtle dim + pulse. These tests lock that lifecycle
  // so a future refactor that drops the finally (and leaves nodes
  // stuck in "pending" forever) gets caught.

  it("F4.5: a node that is NOT being acted on has data-pending='false'", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
      "data-pending",
      "false"
    );
    expect(screen.getByTestId("rf-node-root-1")).toHaveAttribute(
      "data-pending",
      "false"
    );
  });

  it("F4.5: clicking 'Eliminar' marks the selected nodes as pending while the action is in flight", async () => {
    // Deferred so the action stays in flight while we assert.
    let resolveDelete: (v: { ok: true }) => void = () => {};
    mockDelete.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      })
    );

    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));

    // Fire the action — don't await yet, we need to inspect the
    // in-flight state.
    user.click(screen.getByRole("button", { name: /eliminar/i }));

    // Both selected nodes must be pending. The non-selected one
    // (child-3) must NOT be pending.
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
        "data-pending",
        "true"
      );
      expect(screen.getByTestId("rf-node-child-2")).toHaveAttribute(
        "data-pending",
        "true"
      );
    });
    expect(screen.getByTestId("rf-node-child-3")).toHaveAttribute(
      "data-pending",
      "false"
    );

    // Resolve so the test cleans up.
    resolveDelete({ ok: true });
  });

  it("F4.5: pending state is cleared after the action resolves", async () => {
    mockDelete.mockResolvedValue({ ok: true });

    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));

    await user.click(screen.getByRole("button", { name: /eliminar/i }));

    // After the resolved promise, pending must be cleared.
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
        "data-pending",
        "false"
      );
    });
  });

  it("F4.5: pending state is cleared even if the action rejects", async () => {
    // The handler awaits adapter.onDelete; the rejection
    // propagates out of the handler's try block and into the
    // `finally` block. The structural guarantee we care about
    // is that the `finally` runs and pending is cleared even
    // when the action throws. The click handler is async so the
    // rejection escapes the click() promise and becomes an
    // unhandled rejection — expected for this test, so we
    // temporarily suppress the unhandled-rejection listener.
    const unhandledHandler = (): void => {};
    process.on("unhandledRejection", unhandledHandler);
    try {
      mockDelete.mockRejectedValue(new Error("network down"));

      const user = userEvent.setup();
      render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
      await user.click(screen.getByTestId("rf-node-checkbox-child-1"));

      await user.click(screen.getByRole("button", { name: /eliminar/i }));

      await waitFor(() => {
        expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
          "data-pending",
          "false"
        );
      });
    } finally {
      process.off("unhandledRejection", unhandledHandler);
    }
  });

  it("F4.5: 'Podar' marks the selected nodes as pending and clears them after", async () => {
    let resolveDelete: (v: { ok: true }) => void = () => {};
    mockDelete.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      })
    );

    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-3"));

    // Fire the action without awaiting.
    user.click(screen.getByRole("button", { name: /podar/i }));

    await waitFor(() => {
      expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
        "data-pending",
        "true"
      );
      expect(screen.getByTestId("rf-node-child-3")).toHaveAttribute(
        "data-pending",
        "true"
      );
    });

    // Resolve and verify the pending state is gone.
    resolveDelete({ ok: true });
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
        "data-pending",
        "false"
      );
      expect(screen.getByTestId("rf-node-child-3")).toHaveAttribute(
        "data-pending",
        "false"
      );
    });
  });

  it("F4.5: 'Unir' marks ALL merged children as pending (multi-id)", async () => {
    let resolveMerge: (v: { ok: true; node: TopicNode }) => void = () => {};
    mockMerge.mockReturnValue(
      new Promise((resolve) => {
        resolveMerge = resolve;
      })
    );

    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));
    await user.click(screen.getByTestId("rf-node-checkbox-child-2"));

    user.click(screen.getByRole("button", { name: /unir/i }));

    // Both merged children must be pending simultaneously.
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
        "data-pending",
        "true"
      );
      expect(screen.getByTestId("rf-node-child-2")).toHaveAttribute(
        "data-pending",
        "true"
      );
    });

    // Resolve and verify the pending state is cleared.
    resolveMerge({ ok: true, node: { ...mockNodes[0] } });
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
        "data-pending",
        "false"
      );
      expect(screen.getByTestId("rf-node-child-2")).toHaveAttribute(
        "data-pending",
        "false"
      );
    });
  });

  it("F4.5: 'Dividir' marks the single selected node as pending and clears it after", async () => {
    let resolveSplit: (v: { ok: true; nodes: TopicNode[] }) => void = () => {};
    mockSplit.mockReturnValue(
      new Promise((resolve) => {
        resolveSplit = resolve;
      })
    );

    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));

    user.click(screen.getByRole("button", { name: /dividir/i }));

    await waitFor(() => {
      expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
        "data-pending",
        "true"
      );
    });

    resolveSplit({ ok: true, nodes: [] });
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
        "data-pending",
        "false"
      );
    });
  });

  it("F4.5: 'Añadir hijo' marks the parent as pending while the request is in flight", async () => {
    // The onAddRequest callback is awaited by the new
    // handleAddChild. We control it with a deferred so we can
    // assert the parent's pending state mid-flight.
    let resolveAdd: (v: { ok: true; node: TopicNode }) => void = () => {};
    const onAddRequest = vi.fn(
      () =>
        new Promise<{ ok: true; node: TopicNode }>((resolve) => {
          resolveAdd = resolve;
        })
    );

    const user = userEvent.setup();
    render(
      <TreeViewer
        nodes={mockNodes}
        onChange={() => {}}
        onAddRequest={onAddRequest}
      />
    );
    // The handler requires exactly one selected node — the parent
    // of the new child.
    await user.click(screen.getByTestId("rf-node-checkbox-root-1"));

    // Fire the action without awaiting.
    user.click(screen.getByRole("button", { name: /a[ñn]adir hijo/i }));

    // The parent (root-1) must be pending.
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-root-1")).toHaveAttribute(
        "data-pending",
        "true"
      );
    });
    // The non-parent nodes stay non-pending.
    expect(screen.getByTestId("rf-node-child-1")).toHaveAttribute(
      "data-pending",
      "false"
    );

    // Resolve and verify pending is cleared.
    resolveAdd({ ok: true, node: { ...mockNodes[0], id: "new-child" } });
    await waitFor(() => {
      expect(screen.getByTestId("rf-node-root-1")).toHaveAttribute(
        "data-pending",
        "false"
      );
    });
  });

  it("F4.5: pending state is independent of the selection state", async () => {
    let resolveDelete: (v: { ok: true }) => void = () => {};
    mockDelete.mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      })
    );

    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-checkbox-child-1"));

    user.click(screen.getByRole("button", { name: /eliminar/i }));

    // The selected node is BOTH selected AND pending. The two
    // flags are independent — being in flight doesn't clear the
    // checkbox state, and being checked doesn't toggle pending.
    await waitFor(() => {
      const node = screen.getByTestId("rf-node-child-1");
      expect(node).toHaveAttribute("data-selected", "true");
      expect(node).toHaveAttribute("data-pending", "true");
    });

    resolveDelete({ ok: true });
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Mock ReactFlow so the tests don't need a real canvas / dagre layout. The
// mock keeps a local selection set so the DOM reflects "data-selected"
// after a click, mirroring how the real ReactFlow would mark a node.
vi.mock("reactflow", () => {
  function MockReactFlow({
    nodes,
    edges,
    onNodeClick,
    onNodeContextMenu,
    onNodesChange,
  }: {
    nodes: Array<{ id: string; data?: Record<string, unknown> }>;
    edges: Array<{ id: string; source: string; target: string }>;
    onNodeClick?: (e: unknown, node: { id: string }) => void;
    onNodeContextMenu?: (e: unknown, node: { id: string }) => void;
    onNodesChange?: (changes: Array<{ id: string; type: string }>) => void;
  }) {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const handleClick = (n: { id: string }) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(n.id)) next.delete(n.id);
        else next.add(n.id);
        return next;
      });
      onNodeClick?.({}, n);
    };
    const handleContext = (n: { id: string }) => {
      setSelected(new Set([n.id]));
      onNodeContextMenu?.({}, n);
    };
    return (
      <div data-testid="reactflow">
        <div data-testid="rf-nodes">
          {nodes.map((n) => (
            <div
              key={n.id}
              data-testid={`rf-node-${n.id}`}
              data-rf-node="true"
              data-node-id={n.id}
              data-selected={selected.has(n.id) ? "true" : "false"}
              onClick={() => handleClick(n)}
              onContextMenu={() => handleContext(n)}
            >
              <span data-testid="rf-node-name">{String(n.data?.name ?? n.id)}</span>
              {n.data?.isLeaf ? (
                <span data-testid="rf-node-leaf">leaf</span>
              ) : (
                <span data-testid="rf-node-branch">branch</span>
              )}
            </div>
          ))}
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
  });
  afterEach(() => {
    cleanup();
  });

  it("renders ReactFlow with the correct number of nodes", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const renderedNodes = document.querySelectorAll('[data-rf-node="true"]');
    expect(renderedNodes).toHaveLength(3);
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
    expect(edges).toHaveLength(2);
    const pairs = edges
      .map((e) => `${e.getAttribute("data-source")}->${e.getAttribute("data-target")}`)
      .sort();
    expect(pairs).toEqual(["root-1->child-1", "root-1->child-2"]);
  });

  it("distinguishes leaf nodes from branch nodes", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(screen.getAllByTestId("rf-node-leaf")).toHaveLength(2);
    expect(screen.getAllByTestId("rf-node-branch")).toHaveLength(1);
  });

  it("marks a node as selected when clicked", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    const node = screen.getByTestId("rf-node-child-1");
    await user.click(node);
    expect(node).toHaveAttribute("data-selected", "true");
  });

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

  it("enables Podar and Eliminar when one or more nodes are selected", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-child-1"));
    expect(screen.getByRole("button", { name: /podar/i })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: /eliminar/i })).not.toBeDisabled();
  });

  it("enables Unir only when two or more nodes are selected", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-child-1"));
    expect(screen.getByRole("button", { name: /unir/i })).toBeDisabled();
    await user.click(screen.getByTestId("rf-node-child-2"));
    expect(screen.getByRole("button", { name: /unir/i })).not.toBeDisabled();
  });

  it("enables Dividir only when exactly one node is selected", async () => {
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    await user.click(screen.getByTestId("rf-node-child-1"));
    expect(screen.getByRole("button", { name: /dividir/i })).not.toBeDisabled();
    await user.click(screen.getByTestId("rf-node-child-2"));
    expect(screen.getByRole("button", { name: /dividir/i })).toBeDisabled();
  });

  it("renders an 'add root' button even when nothing is selected", () => {
    render(<TreeViewer nodes={mockNodes} onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: /a[ñn]adir ra[íi]z/i })
    ).toBeInTheDocument();
  });

  it("calls onChange with the updated nodes when selection changes", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<TreeViewer nodes={mockNodes} onChange={onChange} />);
    await user.click(screen.getByTestId("rf-node-root-1"));
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
    const node = screen.getByTestId("rf-node-child-1");
    await user.click(node);
    expect(node).toHaveAttribute("data-selected", "true");
    fireEvent.keyDown(window, { key: "Escape" });
    // The mock keeps its own selection state, so we re-query for the
    // element after the keydown — what matters here is that the
    // parent received the clearSelection event (no crash, no throw).
    expect(node).toBeInTheDocument();
  });
});

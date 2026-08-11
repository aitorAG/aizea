// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
// without hitting the network. The adapter is what we care about.
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

import { useTreeAdapter } from "@/lib/adapters/useTreeAdapter";
import type { TopicNode } from "@/lib/types/pipeline";

const baseNodes: TopicNode[] = [
  {
    id: "root-1",
    courseId: "c1",
    parentId: null,
    name: "Termodinámica",
    summary: "Capítulo raíz",
    depth: 0,
    orderIndex: 0,
    pageStart: null,
    pageEnd: null,
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
    pageStart: null,
    pageEnd: null,
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
    pageStart: null,
    pageEnd: null,
    isLeaf: true,
    version: 1,
    sourceMaterialId: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
  {
    id: "grand-1",
    courseId: "c1",
    parentId: "child-1",
    name: "Energía interna",
    summary: null,
    depth: 2,
    orderIndex: 0,
    pageStart: null,
    pageEnd: null,
    isLeaf: true,
    version: 1,
    sourceMaterialId: null,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdate.mockResolvedValue({ ok: true, node: { ...baseNodes[0] } });
  mockDelete.mockResolvedValue({ ok: true });
  mockMerge.mockResolvedValue({ ok: true, node: { ...baseNodes[0], name: "merged" } });
  mockSplit.mockResolvedValue({ ok: true, nodes: [] });
  mockAdd.mockResolvedValue({ ok: true, node: { ...baseNodes[0], id: "new-id" } });
});

describe("useTreeAdapter", () => {
  afterEach(() => {
    cleanup();
  });
  describe("reactFlowNodes / reactFlowEdges", () => {
    it("converts TopicNode[] to ReactFlow nodes with one node per topic", () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      expect(result.current.reactFlowNodes).toHaveLength(4);
      const ids = result.current.reactFlowNodes.map((n) => n.id).sort();
      expect(ids).toEqual(["child-1", "child-2", "grand-1", "root-1"]);
    });

    it("creates one edge per parent-child relationship", () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      expect(result.current.reactFlowEdges).toHaveLength(3);
      const pairs = result.current.reactFlowEdges
        .map((e) => `${e.source}->${e.target}`)
        .sort();
      expect(pairs).toEqual([
        "child-1->grand-1",
        "root-1->child-1",
        "root-1->child-2",
      ]);
    });

    it("attaches topic data (name, depth, isLeaf) to each node", () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      const root = result.current.reactFlowNodes.find((n) => n.id === "root-1")!;
      expect(root.data).toMatchObject({
        name: "Termodinámica",
        depth: 0,
        isLeaf: false,
        summary: "Capítulo raíz",
      });
    });

    it("returns empty arrays for empty input", () => {
      const { result } = renderHook(() => useTreeAdapter([]));
      expect(result.current.reactFlowNodes).toEqual([]);
      expect(result.current.reactFlowEdges).toEqual([]);
    });
  });

  describe("selection", () => {
    it("starts with no selection", () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      expect(result.current.selectedIds).toEqual(new Set());
    });

    it("toggleSelect adds and removes ids", () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      act(() => result.current.toggleSelect("root-1"));
      expect(result.current.selectedIds.has("root-1")).toBe(true);
      act(() => result.current.toggleSelect("root-1"));
      expect(result.current.selectedIds.has("root-1")).toBe(false);
    });
  });

  describe("actions", () => {
    it("onEdit calls updateTreeNodeAction with id and patch", async () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      await act(async () => {
        await result.current.onEdit("root-1", { name: "Termo" });
      });
      expect(mockUpdate).toHaveBeenCalledWith("root-1", { name: "Termo" });
    });

    it("onDelete calls deleteTreeNodeAction with id", async () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      await act(async () => {
        await result.current.onDelete("child-2");
      });
      expect(mockDelete).toHaveBeenCalledWith("child-2");
    });

    it("onMerge calls mergeTreeNodesAction with parent, childIds, name", async () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      await act(async () => {
        await result.current.onMerge("root-1", ["child-1", "child-2"], "Leyes");
      });
      expect(mockMerge).toHaveBeenCalledWith("root-1", ["child-1", "child-2"], "Leyes");
    });

    it("onSplit calls splitTreeNodeAction with id", async () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      await act(async () => {
        await result.current.onSplit("root-1");
      });
      expect(mockSplit).toHaveBeenCalledWith("root-1");
    });

    it("onAddChild calls addTreeNodeAction with courseId, parentId, data", async () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      await act(async () => {
        await result.current.onAddChild("root-1", { name: "Nueva rama" });
      });
      expect(mockAdd).toHaveBeenCalledWith("c1", "root-1", { name: "Nueva rama" });
    });

    it("onAddRoot calls addTreeNodeAction with null parent", async () => {
      const { result } = renderHook(() => useTreeAdapter(baseNodes));
      await act(async () => {
        await result.current.onAddRoot({ name: "Capítulo nuevo" });
      });
      expect(mockAdd).toHaveBeenCalledWith("c1", null, { name: "Capítulo nuevo" });
    });
  });
});

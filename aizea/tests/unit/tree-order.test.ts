import { describe, it, expect } from "vitest";
import { dfsPreorder, type OrderableNode } from "@/lib/domain/pipeline/tree-order";

function n(
  id: string,
  parentId: string | null,
  orderIndex: number,
  name = id
): OrderableNode {
  return { id, parentId, orderIndex, name };
}

describe("dfsPreorder", () => {
  it("returns [] for an empty tree", () => {
    expect(dfsPreorder([])).toEqual([]);
  });

  it("returns a single root unchanged", () => {
    const nodes = [n("a", null, 0)];
    expect(dfsPreorder(nodes).map((x) => x.id)).toEqual(["a"]);
  });

  it("orders roots by orderIndex", () => {
    const nodes = [n("b", null, 1), n("a", null, 0), n("c", null, 2)];
    expect(dfsPreorder(nodes).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("places a parent immediately before its children (pre-order)", () => {
    // root -> [c1, c2]; input deliberately shuffled
    const nodes = [
      n("c2", "root", 1),
      n("root", null, 0),
      n("c1", "root", 0),
    ];
    expect(dfsPreorder(nodes).map((x) => x.id)).toEqual(["root", "c1", "c2"]);
  });

  it("walks a deep tree depth-first (parent, subtree, next sibling)", () => {
    // root -> A(-> A1, A2), B
    const nodes = [
      n("root", null, 0),
      n("A", "root", 0),
      n("B", "root", 1),
      n("A1", "A", 0),
      n("A2", "A", 1),
    ];
    expect(dfsPreorder(nodes).map((x) => x.id)).toEqual([
      "root",
      "A",
      "A1",
      "A2",
      "B",
    ]);
  });

  it("orders siblings by orderIndex, not by insertion or name", () => {
    const nodes = [
      n("root", null, 0),
      n("zzz", "root", 0, "zzz"),
      n("aaa", "root", 1, "aaa"),
    ];
    // zzz has lower orderIndex → comes first despite name
    expect(dfsPreorder(nodes).map((x) => x.id)).toEqual(["root", "zzz", "aaa"]);
  });

  it("breaks orderIndex ties deterministically by name", () => {
    const nodes = [
      n("root", null, 0),
      n("beta", "root", 0, "beta"),
      n("alpha", "root", 0, "alpha"),
    ];
    expect(dfsPreorder(nodes).map((x) => x.id)).toEqual([
      "root",
      "alpha",
      "beta",
    ]);
  });

  it("treats a node whose parent is absent from the set as a root", () => {
    const nodes = [n("child", "ghost", 0), n("real", null, 1)];
    // 'child' becomes a root (parent 'ghost' not present); ordered by index
    expect(dfsPreorder(nodes).map((x) => x.id)).toEqual(["child", "real"]);
  });

  it("is deterministic: same tree → same order across runs", () => {
    const nodes = [
      n("root", null, 0),
      n("A", "root", 0),
      n("B", "root", 1),
      n("A1", "A", 0),
    ];
    const first = dfsPreorder(nodes).map((x) => x.id);
    const second = dfsPreorder([...nodes].reverse()).map((x) => x.id);
    expect(first).toEqual(second);
  });

  it("does not drop nodes even if a cycle exists (cycle guard)", () => {
    // a -> b -> a (cycle); both must still appear exactly once
    const nodes = [n("a", "b", 0), n("b", "a", 0)];
    const out = dfsPreorder(nodes);
    expect(out.length).toBe(2);
    expect(new Set(out.map((x) => x.id))).toEqual(new Set(["a", "b"]));
  });

  it("multiple root subtrees are emitted in full, root order preserved", () => {
    const nodes = [
      n("r2", null, 1),
      n("r1", null, 0),
      n("r1c", "r1", 0),
      n("r2c", "r2", 0),
    ];
    expect(dfsPreorder(nodes).map((x) => x.id)).toEqual([
      "r1",
      "r1c",
      "r2",
      "r2c",
    ]);
  });
});

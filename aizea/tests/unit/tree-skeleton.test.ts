import { describe, it, expect } from "vitest";
import { TreeSkeletonBuilder } from "@/lib/domain/pipeline/tree-skeleton";
import type { SkeletonNode } from "@/lib/application/ports/tree-skeleton.port";

const builder = new TreeSkeletonBuilder();

/** Index the result by ref for easy assertions. */
function byRef(nodes: SkeletonNode[]): Map<string, SkeletonNode> {
  return new Map(nodes.map((n) => [n.ref, n]));
}

describe("TreeSkeletonBuilder", () => {
  it("returns an empty skeleton for no paths", () => {
    expect(builder.fromSectionPaths([])).toEqual([]);
  });

  it("returns an empty skeleton when all titles are blank", () => {
    expect(builder.fromSectionPaths([["", "   "]])).toEqual([]);
  });

  it("makes each distinct top-level title a root at depth 0", () => {
    const nodes = builder.fromSectionPaths([
      ["1. Introducción"],
      ["2. Métodos"],
    ]);
    const m = byRef(nodes);
    expect(m.get("1. Introducción")!.parentRef).toBeNull();
    expect(m.get("1. Introducción")!.depth).toBe(0);
    expect(m.get("2. Métodos")!.parentRef).toBeNull();
  });

  it("dedupes a title that appears in multiple paths into one node", () => {
    const nodes = builder.fromSectionPaths([
      ["1. Intro"],
      ["1. Intro"],
      ["1. Intro"],
    ]);
    expect(nodes.length).toBe(1);
  });

  it("uses breadcrumb adjacency: path[i] is parent of path[i+1]", () => {
    const nodes = builder.fromSectionPaths([
      ["Capítulo 3", "Sección A", "Subsección A.1"],
    ]);
    const m = byRef(nodes);
    expect(m.get("Capítulo 3")!.parentRef).toBeNull();
    expect(m.get("Capítulo 3")!.depth).toBe(0);
    expect(m.get("Sección A")!.parentRef).toBe("Capítulo 3");
    expect(m.get("Sección A")!.depth).toBe(1);
    expect(m.get("Subsección A.1")!.parentRef).toBe("Sección A");
    expect(m.get("Subsección A.1")!.depth).toBe(2);
  });

  it("uses numbering as a fallback: '3.2' hangs under '3'", () => {
    const nodes = builder.fromSectionPaths([
      ["3. Termodinámica"],
      ["3.1 Calor"],
      ["3.2 Entropía"],
    ]);
    const m = byRef(nodes);
    expect(m.get("3. Termodinámica")!.parentRef).toBeNull();
    expect(m.get("3.1 Calor")!.parentRef).toBe("3. Termodinámica");
    expect(m.get("3.2 Entropía")!.parentRef).toBe("3. Termodinámica");
    expect(m.get("3.2 Entropía")!.depth).toBe(1);
  });

  it("derives multi-level depth from numbering ('3.2.1' → depth 2)", () => {
    const nodes = builder.fromSectionPaths([
      ["3. A"],
      ["3.2 B"],
      ["3.2.1 C"],
    ]);
    const m = byRef(nodes);
    expect(m.get("3.2.1 C")!.parentRef).toBe("3.2 B");
    expect(m.get("3.2.1 C")!.depth).toBe(2);
  });

  it("prefers breadcrumb adjacency over numbering when both exist", () => {
    // Numbering would put "3.2 B" under "3. A", but the breadcrumb
    // explicitly nests it under "Parte I" — adjacency wins.
    const nodes = builder.fromSectionPaths([
      ["Parte I", "3.2 B"],
      ["3. A"],
    ]);
    const m = byRef(nodes);
    expect(m.get("3.2 B")!.parentRef).toBe("Parte I");
  });

  it("emits parents before children (topological order)", () => {
    const nodes = builder.fromSectionPaths([
      ["3. A", "3.2 B", "3.2.1 C"],
    ]);
    const pos = new Map(nodes.map((n, i) => [n.ref, i]));
    expect(pos.get("3. A")!).toBeLessThan(pos.get("3.2 B")!);
    expect(pos.get("3.2 B")!).toBeLessThan(pos.get("3.2.1 C")!);
  });

  it("never produces a cycle even if breadcrumbs are contradictory", () => {
    // "A" under "B" in one path, "B" under "A" in another. The builder must
    // break the second assignment to avoid a cycle.
    const nodes = builder.fromSectionPaths([
      ["B", "A"],
      ["A", "B"],
    ]);
    const m = byRef(nodes);
    // Follow each chain to the root — must terminate (no infinite loop).
    for (const start of ["A", "B"]) {
      let cursor: string | null = start;
      const seen = new Set<string>();
      while (cursor !== null) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = m.get(cursor)!.parentRef;
      }
    }
  });

  it("no node references a non-existent parent", () => {
    const nodes = builder.fromSectionPaths([
      ["Cap 1", "1.1 X"],
      ["2. Y"],
    ]);
    const refs = new Set(nodes.map((n) => n.ref));
    for (const n of nodes) {
      if (n.parentRef !== null) expect(refs.has(n.parentRef)).toBe(true);
    }
  });

  it("ignores blank entries within a path without breaking nesting", () => {
    const nodes = builder.fromSectionPaths([["Cap 1", "  ", "1.1 X"]]);
    const m = byRef(nodes);
    expect(m.has("Cap 1")).toBe(true);
    expect(m.has("1.1 X")).toBe(true);
    // Blank was dropped; "1.1 X" nests under "Cap 1" by adjacency of the
    // cleaned path.
    expect(m.get("1.1 X")!.parentRef).toBe("Cap 1");
  });
});

import { describe, it, expect } from "vitest";
import {
  tokenize,
  multiply,
  apply,
  computeDrawingBbox,
  type Matrix,
} from "@/lib/domain/pdf/figure-geometry";

describe("figure-geometry — matrix math", () => {
  it("multiply composes affine matrices (cm semantics: new = m × ctm)", () => {
    // Translate by (10,20) then scale by 2 → point (1,1) maps to (12,22).
    const translate: Matrix = [1, 0, 0, 1, 10, 20];
    const scale: Matrix = [2, 0, 0, 2, 0, 0];
    // Apply scale first (inner), then translate.
    const m = multiply(scale, translate);
    expect(apply(m, 1, 1)).toEqual([12, 22]);
  });

  it("apply maps a point through the matrix", () => {
    expect(apply([2, 0, 0, 3, 5, 7], 1, 1)).toEqual([7, 10]);
  });
});

describe("figure-geometry — tokenize", () => {
  it("collapses literal strings to a placeholder token", () => {
    const toks = tokenize("BT (hello world) Tj ET");
    expect(toks).toContain("(");
    expect(toks).toContain("Tj");
    expect(toks).not.toContain("hello");
  });

  it("keeps names, numbers and operators", () => {
    const toks = tokenize("100 200 300 400 re f /Im0 Do");
    expect(toks).toEqual(["100", "200", "300", "400", "re", "f", "/Im0", "Do"]);
  });

  it("handles hex strings and dict delimiters", () => {
    const toks = tokenize("<48656c6c6f> Tj << /K 1 >>");
    expect(toks).toContain("(");
    expect(toks).toContain("<<");
    expect(toks).toContain(">>");
  });
});

describe("figure-geometry — computeDrawingBbox", () => {
  it("returns the rectangle bbox for a `re` path", () => {
    const box = computeDrawingBbox("100 200 50 80 re f");
    expect(box).toEqual({ x0: 100, y0: 200, x1: 150, y1: 280 });
  });

  it("unions multiple path ops (m/l lines)", () => {
    const box = computeDrawingBbox("10 10 m 90 10 l 90 70 l 10 70 l h S");
    expect(box).toEqual({ x0: 10, y0: 10, x1: 90, y1: 70 });
  });

  it("applies the CTM from `cm` to path coordinates", () => {
    // Scale by 2 then draw a unit rect at origin → bbox 0..2.
    const box = computeDrawingBbox("q 2 0 0 2 0 0 cm 0 0 1 1 re f Q");
    expect(box).toEqual({ x0: 0, y0: 0, x1: 2, y1: 2 });
  });

  it("restores the CTM on `Q` (graphics state pop)", () => {
    // Rect drawn inside q/Q under a translate, then another rect outside.
    const box = computeDrawingBbox(
      "q 1 0 0 1 100 100 cm 0 0 10 10 re f Q 0 0 5 5 re f"
    );
    // First rect: 100..110; second rect: 0..5 → union 0..110.
    expect(box).toEqual({ x0: 0, y0: 0, x1: 110, y1: 110 });
  });

  it("EXCLUDES text drawing (BT…ET) from the bbox", () => {
    // A text block with a Td far away must NOT expand the bbox; only the rect.
    const box = computeDrawingBbox(
      "BT 500 700 Td (hello) Tj ET 10 10 20 20 re f"
    );
    expect(box).toEqual({ x0: 10, y0: 10, x1: 30, y1: 30 });
  });

  it("includes image XObjects drawn via `Do` (unit square × CTM)", () => {
    const box = computeDrawingBbox(
      "q 200 0 0 100 50 60 cm /Im0 Do Q",
      { Im0: { type: "image" } }
    );
    // Unit square mapped by [200 0 0 100 50 60] → x:50..250, y:60..160.
    expect(box).toEqual({ x0: 50, y0: 60, x1: 250, y1: 160 });
  });

  it("includes form XObjects using their declared BBox and Matrix", () => {
    const box = computeDrawingBbox(
      "q 1 0 0 1 10 10 cm /Fm0 Do Q",
      {
        Fm0: {
          type: "form",
          formBbox: { x0: 0, y0: 0, x1: 40, y1: 30 },
        },
      }
    );
    // Form bbox 0..40 × 0..30 translated by (10,10) → 10..50 × 10..40.
    expect(box).toEqual({ x0: 10, y0: 10, x1: 50, y1: 40 });
  });

  it("returns null for a text-only content stream", () => {
    const box = computeDrawingBbox("BT 100 700 Td (only text) Tj ET");
    expect(box).toBeNull();
  });

  it("ignores unknown/absent XObject references safely", () => {
    const box = computeDrawingBbox("/Missing Do 10 10 5 5 re f", {});
    expect(box).toEqual({ x0: 10, y0: 10, x1: 15, y1: 15 });
  });
});

// figure-geometry — pure content-stream geometry analyser (v1.0, Option B).
//
// Computes the bounding box of the DRAWING geometry on a PDF page: path
// construction (m/l/c/v/y/re) and painted XObjects (image + form, via `Do`),
// each transformed by the current transformation matrix (CTM) tracked through
// q/Q/cm. TEXT is intentionally excluded (BT…ET blocks are skipped) so the
// result isolates figures/diagrams from body copy.
//
// This is how the desktop build (which ships WITHOUT docling) recovers a
// figure's bounding box for a "fine crop": docling would give layout bboxes
// but needs Docker; this reads the geometry straight from the PDF, in-process.
//
// Pure and dependency-free (string + numbers only) so it is fully unit-testable.
// The pdf-lib adapter that feeds it lives in figure-geometry.pdflib.ts.

/** A rectangle in PDF user space (origin bottom-left, points = 1/72"). */
export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 2×3 affine matrix [a b c d e f] mapping (x,y) → (a·x+c·y+e, b·x+d·y+f). */
export type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Metadata for an XObject referenced by a `/Name Do` operator. */
export interface XObjectInfo {
  type: "image" | "form";
  /** Form XObjects declare their own /BBox in form space. */
  formBbox?: Bbox;
  /** Form XObjects may declare their own /Matrix (applied before the CTM). */
  formMatrix?: Matrix;
}

/** m' = m × n (matrix concatenation, PDF `cm` semantics: new = cm × CTM). */
export function multiply(m: Matrix, n: Matrix): Matrix {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + b * c2,
    a * b2 + b * d2,
    c * a2 + d * c2,
    c * b2 + d * d2,
    e * a2 + f * c2 + e2,
    e * b2 + f * d2 + f2,
  ];
}

/** Apply a matrix to a point. */
export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function grow(box: Bbox | null, x: number, y: number): Bbox {
  if (!box) return { x0: x, y0: y, x1: x, y1: y };
  return {
    x0: Math.min(box.x0, x),
    y0: Math.min(box.y0, y),
    x1: Math.max(box.x1, x),
    y1: Math.max(box.y1, y),
  };
}

/** Add all four transformed corners of the unit-or-declared rect to the box. */
function growRect(
  box: Bbox | null,
  ctm: Matrix,
  rx0: number,
  ry0: number,
  rx1: number,
  ry1: number
): Bbox {
  let out = box;
  for (const [px, py] of [
    apply(ctm, rx0, ry0),
    apply(ctm, rx1, ry0),
    apply(ctm, rx1, ry1),
    apply(ctm, rx0, ry1),
  ]) {
    out = grow(out, px, py);
  }
  return out as Bbox;
}

/**
 * Tokenise a content stream into whitespace/delimiter separated tokens.
 * Strings `(...)` and hex `<...>` are collapsed to a single "(" placeholder
 * token because their CONTENT never affects geometry — only their operator
 * (Tj/TJ) does, and those live inside BT…ET which we skip anyway.
 */
export function tokenize(content: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const ch = content[i];
    // Whitespace
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === "\f" || ch === "\0") {
      i++;
      continue;
    }
    // Literal string (...) with balanced parens + escapes → placeholder.
    if (ch === "(") {
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        if (content[i] === "\\") {
          i += 2;
          continue;
        }
        if (content[i] === "(") depth++;
        else if (content[i] === ")") depth--;
        i++;
      }
      tokens.push("(");
      continue;
    }
    // Hex string <...> → placeholder. (But <<...>> dict delimiters kept.)
    if (ch === "<" && content[i + 1] !== "<") {
      i++;
      while (i < n && content[i] !== ">") i++;
      i++;
      tokens.push("(");
      continue;
    }
    // Dict delimiters and array delimiters as their own tokens.
    if (ch === "<" && content[i + 1] === "<") {
      tokens.push("<<");
      i += 2;
      continue;
    }
    if (ch === ">" && content[i + 1] === ">") {
      tokens.push(">>");
      i += 2;
      continue;
    }
    if (ch === "[" || ch === "]" || ch === "{" || ch === "}") {
      tokens.push(ch);
      i++;
      continue;
    }
    // Name /Foo or regular token — read until whitespace/delimiter.
    let j = i;
    while (j < n) {
      const c = content[j];
      if (
        c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0" ||
        c === "(" || c === "<" || c === ">" || c === "[" || c === "]" || c === "{" || c === "}" || c === "/"
      ) {
        break;
      }
      j++;
    }
    if (j === i) {
      // A lone "/" name-start: read the name.
      if (content[i] === "/") {
        j = i + 1;
        while (j < n) {
          const c = content[j];
          if (
            c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "\0" ||
            c === "(" || c === "<" || c === ">" || c === "[" || c === "]" || c === "{" || c === "}" || c === "/"
          ) break;
          j++;
        }
        tokens.push(content.slice(i, j));
        i = j;
        continue;
      }
      i++;
      continue;
    }
    tokens.push(content.slice(i, j));
    i = j;
  }
  return tokens;
}

/**
 * Compute the drawing bounding box of a content stream. Returns null when the
 * page has no vector/image drawing operations (text-only page).
 *
 * @param content  decoded content stream (latin1 string)
 * @param xobjects map of XObject resource name (without leading "/") → info
 */
export function computeDrawingBbox(
  content: string,
  xobjects: Record<string, XObjectInfo> = {}
): Bbox | null {
  const tokens = tokenize(content);
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const operands: string[] = [];
  let box: Bbox | null = null;

  // Current path point + subpath start, in user space (pre-CTM coordinates).
  let curX = 0;
  let curY = 0;
  let inText = false;

  const num = (s: string | undefined): number => {
    const v = Number(s);
    return Number.isFinite(v) ? v : 0;
  };

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    // Operators are bare keywords (no leading "/" and not numeric).
    const isNumber = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(tok);
    const isName = tok.startsWith("/");
    if (isNumber || isName || tok === "(" || tok === "[" || tok === "]" || tok === "<<" || tok === ">>" || tok === "{" || tok === "}") {
      operands.push(tok);
      continue;
    }

    // tok is an operator.
    switch (tok) {
      case "BT":
        inText = true;
        break;
      case "ET":
        inText = false;
        break;
      case "q":
        stack.push(ctm);
        break;
      case "Q":
        ctm = stack.pop() ?? IDENTITY;
        break;
      case "cm": {
        const a = num(operands[operands.length - 6]);
        const b = num(operands[operands.length - 5]);
        const c = num(operands[operands.length - 4]);
        const d = num(operands[operands.length - 3]);
        const e = num(operands[operands.length - 2]);
        const f = num(operands[operands.length - 1]);
        ctm = multiply([a, b, c, d, e, f], ctm);
        break;
      }
      // Path construction — record transformed points (skip inside text).
      case "m":
      case "l": {
        if (!inText) {
          curX = num(operands[operands.length - 2]);
          curY = num(operands[operands.length - 1]);
          const [px, py] = apply(ctm, curX, curY);
          box = grow(box, px, py);
        }
        break;
      }
      case "c": {
        if (!inText) {
          // Two control points + endpoint; include all for a safe bound.
          for (let k = 6; k >= 2; k -= 2) {
            const [px, py] = apply(ctm, num(operands[operands.length - k]), num(operands[operands.length - k + 1]));
            box = grow(box, px, py);
          }
          curX = num(operands[operands.length - 2]);
          curY = num(operands[operands.length - 1]);
        }
        break;
      }
      case "v":
      case "y": {
        if (!inText) {
          for (let k = 4; k >= 2; k -= 2) {
            const [px, py] = apply(ctm, num(operands[operands.length - k]), num(operands[operands.length - k + 1]));
            box = grow(box, px, py);
          }
          curX = num(operands[operands.length - 2]);
          curY = num(operands[operands.length - 1]);
        }
        break;
      }
      case "re": {
        if (!inText) {
          const x = num(operands[operands.length - 4]);
          const y = num(operands[operands.length - 3]);
          const w = num(operands[operands.length - 2]);
          const h = num(operands[operands.length - 1]);
          box = growRect(box, ctm, x, y, x + w, y + h);
        }
        break;
      }
      case "Do": {
        const name = operands[operands.length - 1];
        if (name && name.startsWith("/")) {
          const info = xobjects[name.slice(1)];
          if (info) {
            if (info.type === "image") {
              // Images are drawn in the unit square, mapped by the CTM.
              box = growRect(box, ctm, 0, 0, 1, 1);
            } else if (info.type === "form" && info.formBbox) {
              const fm = info.formMatrix ?? IDENTITY;
              const eff = multiply(fm, ctm);
              const b = info.formBbox;
              box = growRect(box, eff, b.x0, b.y0, b.x1, b.y1);
            }
          }
        }
        break;
      }
      default:
        break;
    }
    operands.length = 0;
  }

  return box;
}

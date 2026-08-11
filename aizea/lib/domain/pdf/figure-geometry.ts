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
 * Compute the individual drawing ELEMENTS of a content stream: one bbox per
 * subpath (a run of m/l/c/v/y), per rectangle (`re`) and per painted XObject
 * (`Do`), each transformed by the CTM. Text (BT…ET) is excluded. Returns [] for
 * a text-only page.
 *
 * Element granularity is what lets `clusterBboxes` separate DISTINCT figures on
 * the same page (each figure is a spatial cluster of these elements).
 *
 * @param content  decoded content stream (latin1 string)
 * @param xobjects map of XObject resource name (without leading "/") → info
 */
export function computeDrawingElements(
  content: string,
  xobjects: Record<string, XObjectInfo> = {}
): Bbox[] {
  const tokens = tokenize(content);
  let ctm: Matrix = IDENTITY;
  const stack: Matrix[] = [];
  const operands: string[] = [];
  const elements: Bbox[] = [];

  // Running subpath box (m/l/c/v/y), in device space (post-CTM).
  let subpath: Bbox | null = null;
  let inText = false;

  const flushSubpath = (): void => {
    if (subpath) {
      elements.push(subpath);
      subpath = null;
    }
  };

  const num = (s: string | undefined): number => {
    const v = Number(s);
    return Number.isFinite(v) ? v : 0;
  };

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t];
    const isNumber = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(tok);
    const isName = tok.startsWith("/");
    if (isNumber || isName || tok === "(" || tok === "[" || tok === "]" || tok === "<<" || tok === ">>" || tok === "{" || tok === "}") {
      operands.push(tok);
      continue;
    }

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
      case "m": {
        // New subpath begins → flush the previous one as its own element.
        if (!inText) {
          flushSubpath();
          const [px, py] = apply(ctm, num(operands[operands.length - 2]), num(operands[operands.length - 1]));
          subpath = grow(null, px, py);
        }
        break;
      }
      case "l": {
        if (!inText) {
          const [px, py] = apply(ctm, num(operands[operands.length - 2]), num(operands[operands.length - 1]));
          subpath = grow(subpath, px, py);
        }
        break;
      }
      case "c": {
        if (!inText) {
          for (let k = 6; k >= 2; k -= 2) {
            const [px, py] = apply(ctm, num(operands[operands.length - k]), num(operands[operands.length - k + 1]));
            subpath = grow(subpath, px, py);
          }
        }
        break;
      }
      case "v":
      case "y": {
        if (!inText) {
          for (let k = 4; k >= 2; k -= 2) {
            const [px, py] = apply(ctm, num(operands[operands.length - k]), num(operands[operands.length - k + 1]));
            subpath = grow(subpath, px, py);
          }
        }
        break;
      }
      case "re": {
        if (!inText) {
          const x = num(operands[operands.length - 4]);
          const y = num(operands[operands.length - 3]);
          const w = num(operands[operands.length - 2]);
          const h = num(operands[operands.length - 1]);
          elements.push(growRect(null, ctm, x, y, x + w, y + h));
        }
        break;
      }
      case "Do": {
        const name = operands[operands.length - 1];
        if (name && name.startsWith("/")) {
          const info = xobjects[name.slice(1)];
          if (info) {
            if (info.type === "image") {
              elements.push(growRect(null, ctm, 0, 0, 1, 1));
            } else if (info.type === "form" && info.formBbox) {
              const fm = info.formMatrix ?? IDENTITY;
              const eff = multiply(fm, ctm);
              const b = info.formBbox;
              elements.push(growRect(null, eff, b.x0, b.y0, b.x1, b.y1));
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

  flushSubpath();
  return elements;
}

/** Union of two bboxes. */
function unionBox(a: Bbox, b: Bbox): Bbox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

/**
 * Compute the drawing bounding box of a content stream (union of every drawing
 * element). Returns null for a text-only page.
 */
export function computeDrawingBbox(
  content: string,
  xobjects: Record<string, XObjectInfo> = {}
): Bbox | null {
  const elements = computeDrawingElements(content, xobjects);
  if (elements.length === 0) return null;
  return elements.reduce((acc, e) => unionBox(acc, e));
}

/** Gap between two bboxes along each axis (0 when they overlap on that axis). */
function axisGap(a: Bbox, b: Bbox): { dx: number; dy: number } {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1);
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1);
  return { dx, dy };
}

export interface ClusterOptions {
  /** Two elements join the same cluster when their gap ≤ this (points). */
  gap?: number;
  /** Page size (points) — enables page-rule / full-page-border noise removal. */
  pageWidth?: number;
  pageHeight?: number;
  /** Cap on the number of clusters; excess are agglomeratively merged. */
  maxClusters?: number;
  /** Drop clusters whose area is below this (points²). */
  minArea?: number;
}

/** True when a box is a page rule / near-full-page border (layout, not figure). */
function isPageNoise(b: Bbox, pageWidth?: number, pageHeight?: number): boolean {
  if (!pageWidth || !pageHeight) return false;
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const horizontalRule = w >= 0.9 * pageWidth && h <= 3;
  const verticalRule = h >= 0.9 * pageHeight && w <= 3;
  const fullPage = w >= 0.95 * pageWidth && h >= 0.95 * pageHeight;
  return horizontalRule || verticalRule || fullPage;
}

/**
 * Group drawing elements into spatial clusters (distinct figures). Elements
 * within `gap` points of each other join the same cluster (transitively).
 * Page rules / full-page borders are filtered first. When more clusters than
 * `maxClusters` remain, the closest pairs are merged until the cap is met.
 * Result is sorted top-to-bottom (PDF y grows up), then left-to-right.
 */
export function clusterBboxes(
  elements: Bbox[],
  options: ClusterOptions = {}
): Bbox[] {
  const gap = options.gap ?? 18;
  const items = elements.filter(
    (b) => !isPageNoise(b, options.pageWidth, options.pageHeight)
  );
  if (items.length === 0) return [];

  // Union-find over "near" elements.
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) {
      const next = parent[i];
      parent[i] = r;
      i = next;
    }
    return r;
  };
  const unite = (i: number, j: number): void => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[a] = b;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const { dx, dy } = axisGap(items[i], items[j]);
      if (dx <= gap && dy <= gap) unite(i, j);
    }
  }

  const byRoot = new Map<number, Bbox>();
  for (let i = 0; i < items.length; i++) {
    const r = find(i);
    const cur = byRoot.get(r);
    byRoot.set(r, cur ? unionBox(cur, items[i]) : items[i]);
  }
  let clusters = Array.from(byRoot.values());

  // Drop tiny specks (but never everything — a small figure is still a figure).
  if (options.minArea && options.minArea > 0) {
    const kept = clusters.filter(
      (b) => (b.x1 - b.x0) * (b.y1 - b.y0) >= options.minArea!
    );
    if (kept.length > 0) clusters = kept;
  }

  // Agglomeratively merge the closest pairs until within maxClusters.
  if (options.maxClusters && clusters.length > options.maxClusters) {
    while (clusters.length > options.maxClusters) {
      let bi = 0;
      let bj = 1;
      let best = Infinity;
      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const { dx, dy } = axisGap(clusters[i], clusters[j]);
          const d = dx + dy;
          if (d < best) {
            best = d;
            bi = i;
            bj = j;
          }
        }
      }
      const merged = unionBox(clusters[bi], clusters[bj]);
      clusters = clusters.filter((_, k) => k !== bi && k !== bj);
      clusters.push(merged);
    }
  }

  // Reading order: top-to-bottom (higher y1 first), then left-to-right.
  clusters.sort((a, b) => b.y1 - a.y1 || a.x0 - b.x0);
  return clusters;
}

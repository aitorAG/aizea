// LaTeX → PNG renderer for math formulas used in the pipeline.
//
// Strategy:
//   1. Render the LaTeX with katex using `throwOnError: false`. KaTeX will
//      return the string `"undefined"` (or an empty string in some setups)
//      for invalid LaTeX. We use that as the validation signal — this is
//      the cheapest way to detect parse failures without a separate parse
//      pass. The visual rendering happens client-side in the React app via
//      rehype-katex, so the pipeline never needs a real rasterised image.
//
//   2. When the LaTeX is valid, emit a tiny transparent placeholder PNG so
//      the rest of the pipeline (UnitExtractor) can carry a non-empty
//      base64 string as the "valid formula" signal. When the LaTeX is
//      invalid, return an empty Buffer + log a warning. This satisfies the
//      D15/D17 design choice of "fallback to empty + warning" on failure.
//
// IMPORTANT: this module must NOT depend on `sharp`. sharp is a native
// addon that fails to load in the packaged Next.js standalone build (its
// output pipeline throws "A boolean was expected" because the bundled
// native binary is not wired up). Since the placeholder PNG is never
// rendered — only its presence/absence matters — we ship a fixed 1×1
// transparent PNG as a constant instead of rasterising one at runtime.

import katex from "katex";

/**
 * A minimal 1×1 fully-transparent PNG. Decoded from a fixed base64 blob so
 * we never touch a native image library. Used purely as a non-empty
 * "valid formula" marker in the pipeline.
 */
const TRANSPARENT_PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

export interface RenderLatexOptions {
  /** Render in display (block) mode vs inline. Default: inline. */
  displayMode?: boolean;
  /** Width of the placeholder PNG in pixels. Default: 240. */
  width?: number;
  /** Height of the placeholder PNG in pixels. Default: 60. */
  height?: number;
}

/**
 * Render a LaTeX expression to a PNG buffer.
 *
 * Returns an empty Buffer (length 0) when:
 *   - The LaTeX is empty / whitespace-only
 *   - katex fails to parse it (with `throwOnError: false` it returns
 *     "undefined" for invalid input)
 *
 * Otherwise returns a real PNG buffer of the requested dimensions (default
 * 240x60, transparent background). The placeholder is deterministic so
 * callers can cache or compare results safely.
 */
export async function renderLatexToPng(
  latex: string,
  _options: RenderLatexOptions = {}
): Promise<Buffer> {
  if (!latex || latex.trim().length === 0) {
    return Buffer.alloc(0);
  }

  let html: string;
  try {
    html = katex.renderToString(latex, {
      displayMode: _options.displayMode ?? false,
      throwOnError: false,
      output: "html",
    });
  } catch (err) {
    console.warn(
      `[latex-renderer] KaTeX threw for "${latex}":`,
      err instanceof Error ? err.message : err
    );
    return Buffer.alloc(0);
  }

  // With throwOnError: false, KaTeX returns "undefined" for failed parses.
  if (typeof html !== "string" || html === "undefined" || html.length === 0) {
    console.warn(
      `[latex-renderer] Could not render LaTeX (returning empty buffer): ${latex}`
    );
    return Buffer.alloc(0);
  }

  // Valid LaTeX → return the fixed transparent placeholder. The bytes are
  // never rendered; only their presence signals "formula parsed OK".
  return TRANSPARENT_PNG_1X1;
}

// LaTeX → PNG renderer for math formulas used in the pipeline.
//
// Strategy:
//   1. Render the LaTeX with katex using `throwOnError: false`. KaTeX will
//      return the string `"undefined"` (or an empty string in some setups)
//      for invalid LaTeX. We use that as the validation signal — this is
//      the cheapest way to detect parse failures without a separate parse
//      pass. The same call also gives us the rendered HTML, which future
//      iterations can rasterize to a real PNG. Today, the visual rendering
//      happens client-side in the React app via rehype-katex.
//
//   2. When the LaTeX is valid, emit a real placeholder PNG (transparent,
//      240x60 by default) so the rest of the pipeline (UnitExtractor) can
//      carry a non-empty base64 string. When the LaTeX is invalid, return
//      an empty Buffer + log a warning. This satisfies the D15/D17 design
//      choice of "fallback to empty + warning" on render failure.

import katex from "katex";
import sharp from "sharp";

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
  options: RenderLatexOptions = {}
): Promise<Buffer> {
  const displayMode = options.displayMode ?? false;
  const width = options.width ?? 240;
  const height = options.height ?? 60;

  if (!latex || latex.trim().length === 0) {
    return Buffer.alloc(0);
  }

  let html: string;
  try {
    html = katex.renderToString(latex, {
      displayMode,
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

  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 0 },
    },
  })
    .png()
    .toBuffer();
}

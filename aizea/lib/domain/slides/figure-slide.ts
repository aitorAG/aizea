// Figure-slide helpers (v1.0).
//
// A "figure slide" is a dedicated slide whose visual is a real image extracted
// from the source material (photo/graphic), placed right after the concept it
// belongs to. The image is embedded as a base64 data URI inside `htmlDesign`
// so it renders BOTH in the on-screen iframe (srcdoc) and in the PDF export
// (Chromium setContent) with NO extra file-serving route — figures live in the
// app data dir, unreachable as static assets otherwise.
//
// Pure and dependency-free (string + Buffer only) so it is unit-testable.

/** Detect the image MIME type from magic bytes. Figures are stored as WebP
 *  (post-compression) or left as the PDF's original filter (JPEG for DCTDecode,
 *  PNG placeholders historically). Defaults to png. */
export function imageMimeFromMagic(data: Buffer): string {
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" &&
      data.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp";
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return "image/png";
  }
  return "image/png";
}

/** HTML-escape for the caption text. */
function esc(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the `htmlDesign` for a figure slide: an A4-landscape (1123×794) frame
 * that centres the embedded image with an optional caption underneath. Matches
 * the concept-slide contract (self-contained root div, no <html>/<body>) so the
 * existing iframe/PDF renderers handle it unchanged.
 */
export function buildFigureSlideHtml(params: {
  imageData: Buffer;
  caption: string | null;
}): string {
  const mime = imageMimeFromMagic(params.imageData);
  const b64 = params.imageData.toString("base64");
  const src = `data:${mime};base64,${b64}`;
  const caption = params.caption?.trim();
  const captionHtml = caption
    ? `<div style="margin-top:20px;font-family:system-ui,sans-serif;font-size:20px;color:#374151;text-align:center;max-width:90%;">${esc(caption)}</div>`
    : "";
  return `<div style="width:1123px;height:794px;overflow:hidden;box-sizing:border-box;font-family:system-ui,sans-serif;background:#fff;padding:40px;display:flex;flex-direction:column;align-items:center;justify-content:center;">
  <img src="${src}" alt="${esc(caption ?? "Figura")}" style="max-width:100%;max-height:${caption ? "82%" : "100%"};object-fit:contain;" />
  ${captionHtml}
</div>`;
}

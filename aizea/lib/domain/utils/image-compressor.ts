// Image compressor — converts large image buffers to WebP.
//
// Heuristic: buffers > 200 KB are recompressed as WebP @ q=80. Smaller
// buffers are returned as-is to avoid spending CPU on already-tiny images
// (e.g. icons, transparency tiles). This matches the D15 design constraint
// that figures must be compressed when large.
//
// The threshold and quality are exposed as options so callers can tune
// for their use-case (e.g. preview thumbnails vs. high-DPI source).
//
// Resilience: if sharp throws or returns an invalid buffer, we fall back
// to the original buffer. The pipeline must not stall on a single
// unprocessable image.

import sharp from "sharp";

export interface CompressOptions {
  /** Size in bytes above which compression is triggered. Default: 200 * 1024. */
  thresholdBytes?: number;
  /** WebP quality 1..100. Default: 80. */
  quality?: number;
}

export const DEFAULT_COMPRESS_THRESHOLD_BYTES = 200 * 1024;
export const DEFAULT_COMPRESS_QUALITY = 80;

/**
 * Return a WebP-encoded version of `buffer` if it's larger than the threshold.
 * Otherwise return the buffer unchanged.
 *
 * If sharp is unavailable or the conversion fails, the original buffer is
 * returned (with a warning logged). This keeps the pipeline resilient
 * against missing native binaries or malformed input.
 */
export async function compressToWebP(
  buffer: Buffer,
  options: CompressOptions = {}
): Promise<Buffer> {
  if (buffer.length === 0) {
    return buffer;
  }

  const threshold = options.thresholdBytes ?? DEFAULT_COMPRESS_THRESHOLD_BYTES;
  const quality = options.quality ?? DEFAULT_COMPRESS_QUALITY;

  if (buffer.length <= threshold) {
    return buffer;
  }

  try {
    const result = await sharp(buffer)
      .webp({ quality, effort: 4 })
      .toBuffer();
    if (!result || result.length === 0) {
      return buffer;
    }
    return result;
  } catch (err) {
    console.warn(
      "[image-compressor] sharp failed, returning original buffer:",
      err instanceof Error ? err.message : err
    );
    return buffer;
  }
}

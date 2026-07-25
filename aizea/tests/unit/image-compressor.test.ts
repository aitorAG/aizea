import { describe, it, expect } from "vitest";
import sharp from "sharp";

// Pre-generate a tiny valid PNG (1x1 transparent) so any path that
// actually invokes real sharp completes quickly.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

import { compressToWebP } from "@/lib/domain/utils/image-compressor";

const TWO_HUNDRED_KB = 200 * 1024;

// Build a buffer large enough to trigger compression by repeating the
// tiny PNG payload. Using a real valid image so the call to sharp
// is fast.
function largeBuffer(): Buffer {
  // 5000 × 70 bytes = ~350 KB > 200 KB threshold
  return Buffer.concat(Array(5000).fill(TINY_PNG));
}

describe("image-compressor: compressToWebP", () => {
  it("returns the original buffer unchanged when under 200KB", async () => {
    const original = Buffer.alloc(100 * 1024, 0xff);
    const result = await compressToWebP(original);
    expect(result).toBe(original);
  });

  it("compresses the buffer when it exceeds 200KB", async () => {
    const large = largeBuffer();
    expect(large.length).toBeGreaterThan(TWO_HUNDRED_KB);
    const result = await compressToWebP(large);
    // Real sharp produces a WebP that is smaller than the input.
    expect(result.length).toBeLessThan(large.length);
  });

  it("accepts a custom threshold option", async () => {
    // Use a real PNG repeated to exceed the low 10KB threshold.
    // Raw 0xff bytes are not a valid image and sharp rejects them.
    const buf = Buffer.concat(Array(200).fill(TINY_PNG)); // ~14KB > 10KB
    const result = await compressToWebP(buf, { thresholdBytes: 10 * 1024 });
    expect(result).not.toBe(buf);
  });

  it("accepts a custom quality option", async () => {
    const buf = largeBuffer();
    const result = await compressToWebP(buf, { quality: 50 });
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBeLessThan(buf.length);
  });

  it("returns a Buffer instance", async () => {
    const buf = largeBuffer();
    const result = await compressToWebP(buf);
    expect(result).toBeInstanceOf(Buffer);
  });

  it("does not compress empty buffer", async () => {
    const result = await compressToWebP(Buffer.alloc(0));
    expect(result.length).toBe(0);
  });

  it("uses default 200KB threshold when no options provided", async () => {
    const atThreshold = Buffer.alloc(TWO_HUNDRED_KB, 0xff);
    const result = await compressToWebP(atThreshold);
    expect(result).toBe(atThreshold);

    const over = largeBuffer();
    const result2 = await compressToWebP(over);
    expect(result2).not.toBe(over);
  });
});

// Force reference to keep the import alive for the test.
void sharp;

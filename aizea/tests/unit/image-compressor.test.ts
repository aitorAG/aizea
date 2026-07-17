import { describe, it, expect, vi, beforeEach } from "vitest";
import sharp from "sharp";

// Pre-generate a tiny valid PNG (1x1 transparent) so any path that
// actually invokes real sharp completes quickly. The 0xab buffer was
// hanging the real sharp loader in the full test suite.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

const { webpFn, sharpFn } = vi.hoisted(() => {
  const toBuffer = vi.fn().mockResolvedValue(
    Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
  );
  const webpFn = vi.fn(() => ({ toBuffer }));
  const instance = { webp: webpFn };
  const sharpFn = vi.fn(() => instance);
  return { webpFn, sharpFn };
});

vi.mock("sharp", () => ({
  default: sharpFn,
}));

import { compressToWebP } from "@/lib/domain/utils/image-compressor";

const TWO_HUNDRED_KB = 200 * 1024;

// Build a buffer large enough to trigger compression by repeating the
// tiny PNG payload. Using a real valid image so the call to sharp
// (real or mocked) is fast.
function largeBuffer(): Buffer {
  // 5000 × 70 bytes = ~350 KB > 200 KB threshold
  return Buffer.concat(Array(5000).fill(TINY_PNG));
}

describe("image-compressor: compressToWebP", () => {
  beforeEach(() => {
    sharpFn.mockClear();
    webpFn.mockClear();
  });

  it("returns the original buffer unchanged when under 200KB", async () => {
    const original = Buffer.alloc(100 * 1024, 0xff);
    const result = await compressToWebP(original);
    expect(result).toBe(original);
    expect(sharpFn).not.toHaveBeenCalled();
  });

  it("compresses the buffer when it exceeds 200KB", async () => {
    const large = largeBuffer();
    expect(large.length).toBeGreaterThan(TWO_HUNDRED_KB);
    const result = await compressToWebP(large);
    expect(sharpFn).toHaveBeenCalledWith(large);
    expect(webpFn).toHaveBeenCalledWith(
      expect.objectContaining({ quality: 80 })
    );
    expect(result.length).toBeLessThan(large.length);
  });

  it("accepts a custom threshold option", async () => {
    const buf = Buffer.alloc(50 * 1024, 0xff);
    const result = await compressToWebP(buf, { thresholdBytes: 10 * 1024 });
    expect(result).not.toBe(buf);
    expect(sharpFn).toHaveBeenCalled();
  });

  it("accepts a custom quality option", async () => {
    const buf = largeBuffer();
    await compressToWebP(buf, { quality: 50 });
    expect(webpFn).toHaveBeenCalledWith(expect.objectContaining({ quality: 50 }));
  });

  it("returns a Buffer instance", async () => {
    const buf = largeBuffer();
    const result = await compressToWebP(buf);
    expect(result).toBeInstanceOf(Buffer);
  });

  it("does not compress empty buffer", async () => {
    const result = await compressToWebP(Buffer.alloc(0));
    expect(result.length).toBe(0);
    expect(sharpFn).not.toHaveBeenCalled();
  });

  it("uses default 200KB threshold when no options provided", async () => {
    const atThreshold = Buffer.alloc(TWO_HUNDRED_KB, 0xff);
    const result = await compressToWebP(atThreshold);
    expect(result).toBe(atThreshold);
    expect(sharpFn).not.toHaveBeenCalled();

    const over = largeBuffer();
    const result2 = await compressToWebP(over);
    expect(result2).not.toBe(over);
    expect(sharpFn).toHaveBeenCalled();
  });
});

// Force reference to keep the import alive for the test.
void sharp;

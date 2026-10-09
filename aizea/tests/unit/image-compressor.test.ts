import { beforeEach, describe, it, expect, vi } from "vitest";

const { mockSharp } = vi.hoisted(() => ({
  mockSharp: vi.fn(),
}));

// Sharp is an optional native dependency. Its binary is unavailable in the
// Tauri test environment, so these unit tests mock its API explicitly and
// keep the native failure path covered separately.
vi.mock("sharp", () => ({ default: mockSharp }));

import { compressToWebP } from "@/lib/domain/utils/image-compressor";

const TWO_HUNDRED_KB = 200 * 1024;

function largeBuffer(): Buffer {
  return Buffer.alloc(350 * 1024, 0xff);
}

describe("image-compressor: compressToWebP", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSharp.mockReturnValue({
      webp: vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue(Buffer.from("webp")),
      }),
    });
  });

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
    const buf = Buffer.alloc(14 * 1024, 0xff);
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

  it("returns the original buffer when Sharp fails", async () => {
    mockSharp.mockImplementation(() => {
      throw new Error("A boolean was expected");
    });

    const original = largeBuffer();
    const result = await compressToWebP(original);

    expect(result).toBe(original);
  });
});

import { describe, it, expect } from "vitest";
import { formatElapsed, calculateETA } from "@/lib/utils/format-time";

describe("formatElapsed", () => {
  it("returns '0:00' for 0 ms", () => {
    expect(formatElapsed(0)).toBe("0:00");
  });

  it("returns '0:09' for 9 seconds (pads seconds)", () => {
    expect(formatElapsed(9_000)).toBe("0:09");
  });

  it("returns '0:45' for 45 seconds (compact M:SS)", () => {
    expect(formatElapsed(45_000)).toBe("0:45");
  });

  it("returns '1:00' for exactly 60 seconds", () => {
    expect(formatElapsed(60_000)).toBe("1:00");
  });

  it("uses verbose 'Xm YYs' once we cross 2 minutes", () => {
    expect(formatElapsed(125_000)).toBe("2m 5s");
  });

  it("returns '5m 0s' for 300 seconds", () => {
    expect(formatElapsed(300_000)).toBe("5m 0s");
  });

  it("returns '60m 0s' for 3600 seconds", () => {
    expect(formatElapsed(3_600_000)).toBe("60m 0s");
  });

  it("clamps negative values to '0:00'", () => {
    expect(formatElapsed(-1_000)).toBe("0:00");
  });

  it("rounds down to whole seconds (does not show fractions)", () => {
    // 1.999s should display as 0:01
    expect(formatElapsed(1_999)).toBe("0:01");
  });
});

describe("calculateETA", () => {
  it("returns null when progress is 0 (cannot estimate yet)", () => {
    expect(calculateETA(5_000, 0)).toBeNull();
  });

  it("returns null when progress is negative", () => {
    expect(calculateETA(5_000, -10)).toBeNull();
  });

  it("returns '0:00' when progress is 100 (already done)", () => {
    expect(calculateETA(5_000, 100)).toBe("0:00");
  });

  it("returns null when progress > 100 (defensive)", () => {
    expect(calculateETA(5_000, 150)).toBeNull();
  });

  it("estimates the remaining time as elapsed * (100-p)/p", () => {
    // 60s elapsed, 25% done → (100-25)/25 = 3 → 3m 0s
    expect(calculateETA(60_000, 25)).toBe("3m 0s");
  });

  it("returns a compact M:SS for short ETAs", () => {
    // 30s elapsed, 50% done → (100-50)/50 = 1 → 30s remaining
    expect(calculateETA(30_000, 50)).toBe("0:30");
  });

  it("handles elapsed=0 with positive progress gracefully", () => {
    // 0ms elapsed, 50% done → 0 / 50 * 50 = 0
    expect(calculateETA(0, 50)).toBe("0:00");
  });
});

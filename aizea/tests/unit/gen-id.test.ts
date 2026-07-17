import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { genId } from "@/lib/utils/gen-id";

/**
 * genId has to keep working in non-secure contexts (e.g. when the user
 * opens the app from another machine via the LAN IP instead of
 * localhost). The Web Crypto `crypto.randomUUID()` API is *not* exposed
 * there, so we have to fall back to a Math.random-based UUID v4 shim.
 *
 * These tests pin down both paths and make sure the output is always a
 * RFC 4122 v4 UUID — which is what the rest of the code already
 * assumes when it uses the value as a key.
 */
describe("genId", () => {
  const UUID_V4_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  let originalCryptoDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalCryptoDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "crypto"
    );
  });

  afterEach(() => {
    // Restore whatever was there before the test — Vitest runs in a Node
    // environment where `crypto` is present (we will shadow it case by
    // case instead of always deleting it).
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalCryptoDescriptor);
    } else {
      delete (globalThis as { crypto?: Crypto }).crypto;
    }
    vi.restoreAllMocks();
  });

  describe("when crypto.randomUUID is available", () => {
    it("returns the value produced by crypto.randomUUID()", () => {
      const spy = vi.fn(() => "spy-uuid");
      Object.defineProperty(globalThis, "crypto", {
        value: { randomUUID: spy },
        configurable: true,
        writable: true,
      });

      const id = genId();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(id).toBe("spy-uuid");
    });

    it("prefers the native API over the Math.random fallback", () => {
      // Make the fallback path completely broken to prove we never hit it.
      const mathRandomSpy = vi.spyOn(Math, "random").mockImplementation(() => {
        throw new Error("fallback should not be used when randomUUID exists");
      });
      Object.defineProperty(globalThis, "crypto", {
        value: { randomUUID: () => "native-uuid" },
        configurable: true,
        writable: true,
      });

      const id = genId();

      expect(id).toBe("native-uuid");
      expect(mathRandomSpy).not.toHaveBeenCalled();
    });
  });

  describe("when crypto.randomUUID is NOT available (non-secure context)", () => {
    it("falls back to a Math.random-based UUID v4", () => {
      // Simulate a non-secure context: `crypto` exists but has no
      // `randomUUID` method (this is the actual state in browsers when
      // the page is served over plain HTTP from a non-loopback host).
      Object.defineProperty(globalThis, "crypto", {
        value: {},
        configurable: true,
        writable: true,
      });

      const id = genId();

      expect(id).toMatch(UUID_V4_RE);
    });

    it("falls back when `crypto` itself is undefined", () => {
      // Older environments / SSR safety net.
      delete (globalThis as { crypto?: Crypto }).crypto;

      const id = genId();

      expect(id).toMatch(UUID_V4_RE);
    });

    it("falls back when crypto.randomUUID is not a function (e.g. polyfill stub)", () => {
      Object.defineProperty(globalThis, "crypto", {
        // Some polyfills expose `randomUUID` as `undefined` on
        // non-secure contexts rather than omitting the key.
        value: { randomUUID: undefined },
        configurable: true,
        writable: true,
      });

      const id = genId();

      expect(id).toMatch(UUID_V4_RE);
    });

    it("produces different values across calls", () => {
      Object.defineProperty(globalThis, "crypto", {
        value: {},
        configurable: true,
        writable: true,
      });

      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        ids.add(genId());
      }
      // With 2^122 possible values, 50 draws colliding would be a
      // miracle we want to catch.
      expect(ids.size).toBe(50);
    });
  });
});

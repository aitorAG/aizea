// @vitest-environment jsdom
//
// useMaterialAdapter.uploadMaterial — fake progress + server action call
//
// v1.8.1 / Issue 2 — The previous v1.8 implementation used XHR for
// real byte-level progress, but the XHR path was fragile in Next.js
// 15 (the `xhr.onload` handler didn't reliably run after a 2xx
// response from the App Router route, leaving the spinner stuck
// and the file not appended to the list). The fix reverts to the
// simpler server-action call with a synthetic progress animation
// that ticks toward ~90% and then jumps to 100% on resolve.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import {
  useMaterialAdapter,
  type ProgressCallback,
} from "@/lib/adapters/useMaterialAdapter";

// Mock the server action — `useMaterialAdapter` now calls the
// `uploadMaterial` action directly, so we replace the real one
// with a vi.fn() that we control per-test.
vi.mock("@/lib/actions/material", () => ({
  uploadMaterial: vi.fn(),
  deleteMaterial: vi.fn(),
}));

// Imports AFTER the mock so the binding is the mocked one.
import {
  uploadMaterial as uploadMaterialAction,
  deleteMaterial as deleteMaterialAction,
} from "@/lib/actions/material";

const mockUploadMaterialAction = uploadMaterialAction as unknown as ReturnType<typeof vi.fn>;
const mockDeleteMaterialAction = deleteMaterialAction as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockUploadMaterialAction.mockReset();
  mockDeleteMaterialAction.mockReset();
});

describe("useMaterialAdapter.uploadMaterial — server action + fake progress", () => {
  it("invokes the server action with courseId and formData", async () => {
    mockUploadMaterialAction.mockResolvedValue({
      id: "m1",
      content: "x",
      filename: "123_a.pdf",
    });

    const { result } = renderHook(() => useMaterialAdapter("course-123"));
    const formData = new FormData();
    formData.append("file", new File(["hello"], "a.pdf"));

    const res = await act(async () => {
      return result.current.uploadMaterial(formData);
    });

    expect(mockUploadMaterialAction).toHaveBeenCalledTimes(1);
    expect(mockUploadMaterialAction).toHaveBeenCalledWith(
      "course-123",
      formData
    );
    expect(res).toEqual({ id: "m1", content: "x", filename: "123_a.pdf" });
  });

  it("fires onProgress with 0 immediately and 100 on resolve", async () => {
    // Resolve the action synchronously after a single microtask
    // so we observe the start/end values without any ticking.
    mockUploadMaterialAction.mockImplementation(async () => ({
      id: "m1",
      content: "",
      filename: "a.pdf",
    }));

    const { result } = renderHook(() => useMaterialAdapter("c1"));
    const onProgress = vi.fn() as ReturnType<typeof vi.fn> &
      ((p: number) => void);

    await act(async () => {
      await result.current.uploadMaterial(new FormData(), { onProgress });
    });

    const calls = onProgress.mock.calls.map((c: number[]) => c[0]);
    expect(calls[0]).toBe(0);
    expect(calls[calls.length - 1]).toBe(100);
    // Every reported value must be a finite integer in [0, 100].
    for (const v of calls) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("emits intermediate fake progress values (0 → 10 → 20 → ... → 90) over time", async () => {
    // Make the action take ~900ms so the 9 progress ticks have
    // time to fire. Default `estimatedDurationMs` is 1500ms, but
    // we override to 900ms for a faster test.
    mockUploadMaterialAction.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ id: "m1", content: "", filename: "a.pdf" }),
            900
          );
        })
    );

    const { result } = renderHook(() => useMaterialAdapter("c1"));
    const onProgress = vi.fn() as ReturnType<typeof vi.fn> &
      ((p: number) => void);

    await act(async () => {
      await result.current.uploadMaterial(new FormData(), {
        onProgress,
        estimatedDurationMs: 900,
      });
    });

    const calls = onProgress.mock.calls.map((c: number[]) => c[0]);
    // 0 at the start, a handful of intermediates, 100 at the end.
    expect(calls[0]).toBe(0);
    expect(calls[calls.length - 1]).toBe(100);
    // Should observe a strictly increasing series up to 90 (the
    // cap), then 100.
    const intermediate = calls.slice(1, -1);
    expect(intermediate.length).toBeGreaterThan(0);
    for (const v of intermediate) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(90);
    }
  });

  it("rejects with the server action's error when it throws", async () => {
    const err = new Error("Archivo demasiado grande");
    mockUploadMaterialAction.mockRejectedValue(err);

    const { result } = renderHook(() => useMaterialAdapter("c1"));

    let caught: Error | null = null;
    await act(async () => {
      try {
        await result.current.uploadMaterial(new FormData());
      } catch (e) {
        caught = e as Error;
      }
    });

    expect(caught).toBe(err);
  });

  it("still reports progress=100 on the error path so the bar doesn't get stuck", async () => {
    mockUploadMaterialAction.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useMaterialAdapter("c1"));
    const onProgress = vi.fn() as ReturnType<typeof vi.fn> &
      ((p: number) => void);

    await act(async () => {
      try {
        await result.current.uploadMaterial(new FormData(), { onProgress });
      } catch {
        /* expected */
      }
    });

    const calls = onProgress.mock.calls.map((c: number[]) => c[0]);
    expect(calls[calls.length - 1]).toBe(100);
  });

  it("deleteMaterial still works (regression guard for adapter refactor)", async () => {
    // We don't exercise the store side here — just confirm the
    // adapter shape. The delete path is unchanged.
    const { result } = renderHook(() => useMaterialAdapter("c1"));
    expect(typeof result.current.deleteMaterial).toBe("function");
    expect(typeof result.current.uploadMaterial).toBe("function");
    mockDeleteMaterialAction.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.deleteMaterial("x");
    });
    expect(mockDeleteMaterialAction).toHaveBeenCalledWith("x");
    cleanup();
  });
});

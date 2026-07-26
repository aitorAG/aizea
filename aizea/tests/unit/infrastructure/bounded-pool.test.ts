import { describe, it, expect, vi } from "vitest";
import { BoundedPool } from "@/lib/infrastructure/concurrency/bounded-pool";
import { PoolAbortedError } from "@/lib/application/ports/concurrency.port";

/** Promesa controlable manualmente para orquestar timing en los tests. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("BoundedPool", () => {
  it("returns an empty array for an empty input without calling fn", async () => {
    const pool = new BoundedPool();
    const fn = vi.fn();
    const out = await pool.map([], fn, { limit: 4 });
    expect(out).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("preserves order: results[i] matches items[i] regardless of finish order", async () => {
    const pool = new BoundedPool();
    // Later items resolve FASTER, so completion order != input order.
    const items = [50, 30, 10, 40, 20];
    const out = await pool.map(
      items,
      async (ms) => {
        await new Promise((r) => setTimeout(r, ms));
        return ms * 2;
      },
      { limit: 3 }
    );
    expect(out).toEqual([100, 60, 20, 80, 40]);
  });

  it("respects the concurrency limit (never more than `limit` in flight)", async () => {
    const pool = new BoundedPool();
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 20 }, (_, i) => i);
    await pool.map(
      items,
      async (i) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return i;
      },
      { limit: 4 }
    );
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // actually parallel
  });

  it("processes all items with a limit larger than the item count", async () => {
    const pool = new BoundedPool();
    const items = [1, 2, 3];
    const out = await pool.map(items, async (n) => n + 10, { limit: 99 });
    expect(out).toEqual([11, 12, 13]);
  });

  it("reports progress once per completed task, ending at total", async () => {
    const pool = new BoundedPool();
    const items = Array.from({ length: 6 }, (_, i) => i);
    const seen: Array<[number, number]> = [];
    await pool.map(items, async (i) => i, {
      limit: 2,
      onProgress: (completed, total) => seen.push([completed, total]),
    });
    expect(seen.length).toBe(6);
    expect(seen[seen.length - 1]).toEqual([6, 6]);
    // Completed count is monotonically increasing.
    const counts = seen.map(([c]) => c);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it("fail-fast: rejects with the first error and stops taking new items", async () => {
    const pool = new BoundedPool();
    const started: number[] = [];
    const items = Array.from({ length: 10 }, (_, i) => i);
    await expect(
      pool.map(
        items,
        async (i) => {
          started.push(i);
          if (i === 1) throw new Error("boom at 1");
          await new Promise((r) => setTimeout(r, 5));
          return i;
        },
        { limit: 2 }
      )
    ).rejects.toThrow("boom at 1");
    // With limit 2, items 0 and 1 start; after 1 throws, no new items (>=2)
    // should be picked up.
    expect(started).not.toContain(5);
    expect(started.length).toBeLessThan(items.length);
  });

  it("fail-fast drains in-flight tasks before rejecting (no orphans)", async () => {
    const pool = new BoundedPool();
    let resolvedInFlight = false;
    const slow = deferred<number>();
    const items = [0, 1];
    const promise = pool.map(
      items,
      async (i) => {
        if (i === 0) {
          // in-flight slow task
          const v = await slow.promise;
          resolvedInFlight = true;
          return v;
        }
        throw new Error("fast fail");
      },
      { limit: 2 }
    );
    await tick();
    // Item 1 failed fast, but item 0 is still in flight; the map must not
    // have rejected yet (it waits to drain).
    let settled = false;
    void promise.then(
      () => (settled = true),
      () => (settled = true)
    );
    await tick();
    expect(settled).toBe(false);
    // Now let the in-flight task finish → then the map rejects.
    slow.resolve(42);
    await expect(promise).rejects.toThrow("fast fail");
    expect(resolvedInFlight).toBe(true);
  });

  it("throws PoolAbortedError immediately if the signal is already aborted", async () => {
    const pool = new BoundedPool();
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(async (n: number) => n);
    await expect(
      pool.map([1, 2, 3], fn, { limit: 2, signal: controller.signal })
    ).rejects.toBeInstanceOf(PoolAbortedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("aborting mid-run stops taking new items and rejects with PoolAbortedError", async () => {
    const pool = new BoundedPool();
    const controller = new AbortController();
    const started: number[] = [];
    const items = Array.from({ length: 10 }, (_, i) => i);
    const promise = pool.map(
      items,
      async (i) => {
        started.push(i);
        await new Promise((r) => setTimeout(r, 10));
        if (i === 1) controller.abort();
        return i;
      },
      { limit: 2, signal: controller.signal }
    );
    await expect(promise).rejects.toBeInstanceOf(PoolAbortedError);
    expect(started.length).toBeLessThan(items.length);
  });

  it("passes a live AbortSignal to fn", async () => {
    const pool = new BoundedPool();
    const controller = new AbortController();
    let receivedSignal: AbortSignal | undefined;
    const promise = pool.map(
      [0, 1],
      async (i, _idx, signal) => {
        receivedSignal = signal;
        if (i === 0) controller.abort();
        return i;
      },
      { limit: 1, signal: controller.signal }
    );
    await promise.catch(() => {});
    expect(receivedSignal).toBeDefined();
    expect(receivedSignal).toBe(controller.signal);
  });

  it("floors and clamps the limit to at least 1", async () => {
    const pool = new BoundedPool();
    const out = await pool.map([1, 2], async (n) => n, { limit: 0 });
    expect(out).toEqual([1, 2]);
  });
});

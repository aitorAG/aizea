import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SlideGenerationQueue,
  type SlideGenerationService,
  type SlideGenerationSummary,
} from "@/lib/infrastructure/queue/SlideGenerationQueue";
import type {
  SlideGenerationStore,
  SlideJobState,
} from "@/lib/stores/useSlideGenerationStore";

/**
 * v1.10 / Wave 2 — Slide generation queue tests.
 *
 * The queue is timing-sensitive (it owns the concurrency budget)
 * so the tests use a controllable `SlideService` mock that records
 * concurrent invocations and resolves on demand. Each test builds
 * its own mock to keep timing assertions independent.
 *
 * v1.10 / Wave 2 — the queue now consumes the production
 * service interface (`generateSlideContent` /
 * `regenerateHtmlDesign`) so the mock aligns with the real
 * `SlideService` shape.
 */

interface RecordedCall {
  slideId: string;
  phase: "content" | "html";
  startedAt: number;
  finishedAt?: number;
  error?: Error;
}

interface MockSlideServiceOpts {
  /** Number of failures to inject per (slideId, phase) tuple before succeeding. */
  failBeforeSuccess?: number;
  /** Always-failing jobs keyed by `${slideId}:${phase}`. */
  alwaysFail?: Set<string>;
  /** Optional latency (ms) per call. */
  latencyMs?: number;
}

function createMockSlideService(opts: MockSlideServiceOpts = {}) {
  const calls: RecordedCall[] = [];
  let active = 0;
  let peakActive = 0;
  // failuresRemaining[`slideId:phase`] counts remaining failures to inject
  // before the call resolves successfully.
  const failuresRemaining = new Map<string, number>();

  const failBeforeSuccess = opts.failBeforeSuccess ?? 0;
  const alwaysFail = opts.alwaysFail ?? new Set<string>();
  const latencyMs = opts.latencyMs ?? 0;

  function delay(ms: number) {
    if (ms <= 0) return Promise.resolve();
    return new Promise<void>((r) => setTimeout(r, ms));
  }

  async function runPhase(slideId: string, phase: "content" | "html") {
    const key = `${slideId}:${phase}`;
    const record: RecordedCall = {
      slideId,
      phase,
      startedAt: Date.now(),
    };
    calls.push(record);
    active++;
    peakActive = Math.max(peakActive, active);
    try {
      await delay(latencyMs);
      if (alwaysFail.has(key)) {
        record.error = new Error(`${phase} always fails for ${slideId}`);
        throw record.error;
      }
      const remaining = failuresRemaining.get(key) ?? failBeforeSuccess;
      if (remaining > 0) {
        failuresRemaining.set(key, remaining - 1);
        record.error = new Error(`${phase} transient failure for ${slideId}`);
        throw record.error;
      }
    } finally {
      record.finishedAt = Date.now();
      active--;
    }
  }

  const service: SlideGenerationService = {
    generateSlideContent: vi.fn(async (id: string) => {
      await runPhase(id, "content");
      return {
        script: "s",
        relevance: "r",
        narrative: "n",
        exercise1: "e1",
        exercise2: "e2",
      };
    }),
    regenerateHtmlDesign: vi.fn(async (id: string) => {
      await runPhase(id, "html");
      return "<div></div>";
    }),
  };

  return {
    service,
    calls,
    getActive: () => active,
    getPeakActive: () => peakActive,
  };
}

function createMockStore(): SlideGenerationStore & {
  jobs: Map<string, SlideJobState>;
  startGenerationCalls: string[][];
  updateJobCalls: Array<{ id: string; partial: Partial<SlideJobState> }>;
  markCompletedCalls: string[];
  markFailedCalls: Array<{ id: string; error: string }>;
} {
  const jobs = new Map<string, SlideJobState>();
  const startGenerationCalls: string[][] = [];
  const updateJobCalls: Array<{ id: string; partial: Partial<SlideJobState> }> = [];
  const markCompletedCalls: string[] = [];
  const markFailedCalls: Array<{ id: string; error: string }> = [];

  return {
    jobs,
    startGenerationCalls,
    updateJobCalls,
    markCompletedCalls,
    markFailedCalls,
    // The queue calls these as plain functions; tests assert
    // on the `*Calls` arrays above for visibility, but we also
    // expose `vi.fn()` wrappers so the suite can use
    // `toHaveBeenCalledWith(...)` when verifying exact
    // arguments.
    startGeneration: vi.fn((ids: string[]) => {
      startGenerationCalls.push([...ids]);
      jobs.clear();
      ids.forEach((id) =>
        jobs.set(id, {
          slideId: id,
          status: "pending",
          retries: 0,
          phase: "content",
        })
      );
    }),
    updateJob: vi.fn((id: string, partial: Partial<SlideJobState>) => {
      updateJobCalls.push({ id, partial });
      const existing = jobs.get(id);
      if (existing) {
        jobs.set(id, { ...existing, ...partial });
      }
    }),
    markCompleted: vi.fn((id: string) => {
      markCompletedCalls.push(id);
      const job = jobs.get(id);
      if (job) jobs.set(id, { ...job, status: "completed" });
    }),
    markFailed: vi.fn((id: string, error: string) => {
      markFailedCalls.push({ id, error });
      const job = jobs.get(id);
      if (job) jobs.set(id, { ...job, status: "failed", error });
    }),
  };
}

/** Wait for the predicate to return truthy or the deadline to elapse. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  stepMs = 5
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

describe("SlideGenerationQueue — concurrency", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("enqueues 10 slides and processes at most 5 concurrently (default cap)", async () => {
    // Slow LLM calls so all 10 jobs overlap in time.
    const mock = createMockSlideService({ latencyMs: 30 });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store);

    const slideIds = Array.from({ length: 10 }, (_, i) => `slide-${i}`);
    await queue.enqueueAll(slideIds);

    // Wait until all jobs are completed before sampling peak concurrency.
    await waitFor(() => mock.calls.length === 20); // 10 slides × 2 phases
    // The pump should also have settled by now.
    await waitFor(() => store.markCompletedCalls.length === 10);

    expect(store.startGenerationCalls).toEqual([slideIds]);
    expect(mock.getPeakActive()).toBeLessThanOrEqual(5);
    // 10 slides × 2 phases (content + html) = 20 total invocations.
    expect(mock.calls).toHaveLength(20);
    expect(store.markCompletedCalls).toHaveLength(10);
    expect(store.markFailedCalls).toHaveLength(0);
  });

  it("honours a custom concurrency cap (3)", async () => {
    const mock = createMockSlideService({ latencyMs: 30 });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store, {
      concurrency: 3,
    });

    const slideIds = Array.from({ length: 9 }, (_, i) => `slide-${i}`);
    await queue.enqueueAll(slideIds);
    await waitFor(() => store.markCompletedCalls.length === 9);

    expect(mock.getPeakActive()).toBeLessThanOrEqual(3);
  });

  it("starts a new job as soon as an in-flight one finishes", async () => {
    const mock = createMockSlideService({ latencyMs: 20 });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store);

    await queue.enqueueAll(["a", "b", "c", "d", "e", "f", "g", "h"]);
    await waitFor(() => store.markCompletedCalls.length === 8, 5000);

    const contentCalls = mock.calls.filter((c) => c.phase === "content");
    expect(contentCalls).toHaveLength(8);
    const firstFinish = mock.calls.find(
      (c) => c.slideId === "a" && c.phase === "content"
    )?.finishedAt;
    const sixthStart = contentCalls[5]?.startedAt;
    expect(firstFinish).toBeDefined();
    expect(sixthStart).toBeDefined();
    expect(sixthStart!).toBeGreaterThanOrEqual(firstFinish!);
    expect(mock.getPeakActive()).toBeLessThanOrEqual(5);
  });
});

describe("SlideGenerationQueue — retry", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("retries the content phase up to maxRetries times before marking failed", async () => {
    const alwaysFailContent = new Set(["problem-slide:content"]);
    const mock = createMockSlideService({
      alwaysFail: alwaysFailContent,
      latencyMs: 0,
    });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store, {
      maxRetries: 3,
      // Tests run with no delay between retries so the suite
      // finishes in seconds, not minutes.
      retryDelayMs: 0,
    });

    await queue.enqueueAll(["problem-slide", "other-slide"]);
    await waitFor(() => store.markFailedCalls.length === 1, 2000);
    await waitFor(() => store.markCompletedCalls.length === 1, 2000);

    // 3 content attempts for problem-slide + 1 content + 1 html
    // for other-slide.
    const problemContent = mock.calls.filter(
      (c) => c.slideId === "problem-slide" && c.phase === "content"
    );
    expect(problemContent).toHaveLength(3);
    // HTML must NOT be attempted when content has failed out.
    const problemHtml = mock.calls.filter(
      (c) => c.slideId === "problem-slide" && c.phase === "html"
    );
    expect(problemHtml).toHaveLength(0);

    expect(store.markFailedCalls).toHaveLength(1);
    expect(store.markFailedCalls[0].id).toBe("problem-slide");
    expect(store.markFailedCalls[0].error).toMatch(/content always fails/);
    expect(store.markCompletedCalls).toEqual(["other-slide"]);
    expect(store.jobs.get("problem-slide")?.status).toBe("failed");
  });

  it("retries the HTML phase up to maxRetries times before marking failed", async () => {
    const alwaysFailHtml = new Set(["broken-slide:html"]);
    const mock = createMockSlideService({
      alwaysFail: alwaysFailHtml,
      latencyMs: 0,
    });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store, {
      maxRetries: 3,
      retryDelayMs: 0,
    });

    await queue.enqueueAll(["broken-slide", "ok-slide"]);
    await waitFor(() => store.markFailedCalls.length === 1, 2000);
    await waitFor(() => store.markCompletedCalls.length === 1, 2000);

    const brokenContent = mock.calls.filter(
      (c) => c.slideId === "broken-slide" && c.phase === "content"
    );
    expect(brokenContent).toHaveLength(1);
    const brokenHtml = mock.calls.filter(
      (c) => c.slideId === "broken-slide" && c.phase === "html"
    );
    expect(brokenHtml).toHaveLength(3);

    expect(store.markFailedCalls).toHaveLength(1);
    expect(store.markFailedCalls[0].id).toBe("broken-slide");
    expect(store.markFailedCalls[0].error).toMatch(/html always fails/);
    expect(store.markCompletedCalls).toEqual(["ok-slide"]);
    expect(store.jobs.get("broken-slide")?.status).toBe("failed");
  });

  it("succeeds on the second attempt for the content phase", async () => {
    const mock = createMockSlideService({
      failBeforeSuccess: 1,
      latencyMs: 0,
    });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store, {
      maxRetries: 3,
      retryDelayMs: 0,
    });

    await queue.enqueueAll(["s1"]);
    await waitFor(() => store.markCompletedCalls.length === 1);

    expect(mock.calls.filter((c) => c.phase === "content")).toHaveLength(2);
    expect(store.markCompletedCalls).toEqual(["s1"]);
    expect(store.markFailedCalls).toEqual([]);
  });
});

describe("SlideGenerationQueue — phase selection", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("only runs the content phase when phases=['content']", async () => {
    const mock = createMockSlideService({ latencyMs: 0 });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store);

    const summary = await queue.enqueueAll(["s1"], { phases: ["content"] });

    expect(summary.succeeded).toBe(1);
    expect(mock.service.generateSlideContent).toHaveBeenCalledTimes(1);
    expect(mock.service.regenerateHtmlDesign).not.toHaveBeenCalled();
    expect(store.markCompleted).toHaveBeenCalledWith("s1");
  });

  it("runs both phases by default", async () => {
    const mock = createMockSlideService({ latencyMs: 0 });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store);

    await queue.enqueueAll(["s1"]);

    expect(mock.service.generateSlideContent).toHaveBeenCalledTimes(1);
    expect(mock.service.regenerateHtmlDesign).toHaveBeenCalledTimes(1);
  });
});

describe("SlideGenerationQueue — cancel", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("stops dispatching new slides after cancel() is called", async () => {
    const mock = createMockSlideService({ latencyMs: 30 });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store, {
      concurrency: 1,
    });

    const promise = queue.enqueueAll(["s1", "s2", "s3", "s4"]);
    // Wait for the first slide to start its content phase.
    await waitFor(
      () => mock.calls.filter((c) => c.phase === "content").length === 1
    );
    queue.cancel();

    // Resolve the in-flight call by waiting it out.
    await promise;

    // The cancel should have prevented the remaining slides from
    // even starting. Some may have been dispatched before the
    // cancel took effect (concurrency=1), but the count is bounded.
    const contentCalls = mock.calls.filter((c) => c.phase === "content");
    expect(contentCalls.length).toBeLessThanOrEqual(2);
  });
});

describe("SlideGenerationQueue — double enqueue", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("ignores a second enqueueAll call while a batch is in flight", async () => {
    const mock = createMockSlideService({ latencyMs: 20 });
    const store = createMockStore();
    const queue = new SlideGenerationQueue(mock.service, store);

    const first = queue.enqueueAll(["s1", "s2"]);
    const second = queue.enqueueAll(["other1", "other2"]);

    // Both calls return the same promise — the second batch is
    // ignored while the first is in flight.
    expect(first).toBe(second);

    await first;
    // Only the first batch ran; the second batch's ids never
    // appeared in the store.
    expect(store.startGenerationCalls).toEqual([["s1", "s2"]]);
  });
});

describe("SlideGenerationQueue — onComplete callback", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("fires exactly once per batch, after every slide settles", async () => {
    const mock = createMockSlideService({ latencyMs: 0 });
    const store = createMockStore();
    const onComplete = vi.fn();
    const queue = new SlideGenerationQueue(mock.service, store, {
      onComplete,
    });

    await queue.enqueueAll(["s1", "s2", "s3"]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    const summary = onComplete.mock.calls[0][0] as SlideGenerationSummary;
    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(3);
    expect(summary.failed).toBe(0);
  });

  it("fires with a mixed success/failure summary", async () => {
    const mock = createMockSlideService({ latencyMs: 0 });
    const store = createMockStore();
    const onComplete = vi.fn();
    const queue = new SlideGenerationQueue(mock.service, store, {
      maxRetries: 1,
      onComplete,
    });

    // Patch the mock to fail on a specific id.
    mock.service.generateSlideContent = vi.fn(async (id: string) => {
      if (id === "bad") throw new Error("nope");
      return { ok: true };
    });

    await queue.enqueueAll(["good", "bad"]);
    const summary = onComplete.mock.calls[0][0] as SlideGenerationSummary;
    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(1);
  });
});

describe("SlideGenerationQueue — designInstructions passthrough", () => {
  it("forwards the designInstructions option to the html phase", async () => {
    const store = createMockStore();
    const service: SlideGenerationService = {
      generateSlideContent: vi.fn(async () => ({})),
      regenerateHtmlDesign: vi.fn(async () => "<div></div>"),
    };
    const queue = new SlideGenerationQueue(service, store);

    await queue.enqueueAll(["s1"], { designInstructions: "use 2 columns" });

    expect(service.regenerateHtmlDesign).toHaveBeenCalledWith(
      "s1",
      "use 2 columns"
    );
  });

  it("defaults the designInstructions to an empty string", async () => {
    const store = createMockStore();
    const service: SlideGenerationService = {
      generateSlideContent: vi.fn(async () => ({})),
      regenerateHtmlDesign: vi.fn(async () => "<div></div>"),
    };
    const queue = new SlideGenerationQueue(service, store);

    await queue.enqueueAll(["s1"]);

    expect(service.regenerateHtmlDesign).toHaveBeenCalledWith("s1", "");
  });
});

afterEach(() => {
  vi.useRealTimers();
});

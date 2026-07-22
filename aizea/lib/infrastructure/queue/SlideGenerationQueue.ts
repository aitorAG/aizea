import type { SlideGenerationStore } from "@/lib/stores/useSlideGenerationStore";

/**
 * v1.10 / Wave 2 — In-process slide generation queue.
 *
 * Drives the per-slide pipeline (content → HTML) for a batch of
 * slides with bounded concurrency. Unlike the BullMQ-backed
 * `JobQueue`, this queue lives entirely in the browser/Node
 * process: the slides page already has the slide ids in memory,
 * and round-tripping each slide through Redis would add a network
 * hop per LLM call without improving throughput.
 *
 * The queue is intentionally minimal: a FIFO array, an `active`
 * slot counter, and a configurable `concurrency` cap (3 by
 * default). A job is a single slide; each job runs through two
 * sequential phases (content, then HTML) and each phase is
 * retried up to `maxRetries` (3 by default) times before the
 * slide is marked `failed`. The first failing phase short-circuits
 * the rest of the job — there's no point generating HTML for a
 * slide whose content step just gave up.
 *
 * Concurrency model:
 *   - `enqueueAll` pushes ids into the FIFO and kicks the pump.
 *   - `processQueue` drains the FIFO while respecting the active
 *     slot count. When a job finishes, the slot is freed and the
 *     pump runs again. The recursion bottoms out when the queue
 *     is empty and no slots are active.
 *   - `processJob` is fire-and-forget from the queue's
 *     perspective (the `.finally` decrements `active` and
 *     re-pumps). The promise it returns is intentionally ignored
 *     so a slow job doesn't stall sibling starts.
 *
 * Cancellation:
 *   - `cancel()` flips an internal flag. In-flight jobs are NOT
 *     interrupted (we can't safely abort a network call that's
 *     already in flight) but the pump stops dispatching new ones
 *     and `enqueueAll`'s returned promise resolves with
 *     `cancelled: true` once the in-flight ones finish.
 *
 * Why does the queue take the store as a constructor arg, not
 * subscribe to it?
 *   - The queue is the PRODUCER of state changes; the UI
 *     subscribes. Mirrors the `usePipelineStore` pattern: a
 *     non-React orchestrator pushes to a store that React
 *     components observe via `useStore((s) => s.jobs)`.
 */
export interface SlideGenerationService {
  /** Generate the text content boxes for a slide. */
  generateSlideContent(slideId: string): Promise<unknown>;
  /** Generate (or regenerate) the HTML design for a slide. */
  regenerateHtmlDesign(
    slideId: string,
    designInstructions: string
  ): Promise<unknown>;
}

export interface SlideGenerationQueueOptions {
  /** Maximum number of slides running through the LLM at the
   *  same time. Defaults to 3 — the OpenRouter rate limit on
   *  the free tier is comfortable with three concurrent calls
   *  and any more risks 429s cascading into spurious failures.
   *  The previous Wave 1 implementation used 5; the new default
   *  is more conservative because users frequently run other
   *  pipelines concurrently. */
  concurrency?: number;
  /** Per-phase retry budget. Defaults to 3, matching the
   *  sequential loop this queue replaces. */
  maxRetries?: number;
  /** Delay between retries, in ms. Defaults to 1000. */
  retryDelayMs?: number;
  /** Optional callback fired exactly once when every slide in
   *  the batch has reached a terminal state. The slides page
   *  uses it to surface the completion toast + revalidate the
   *  server cache. */
  onComplete?: (summary: SlideGenerationSummary) => void;
  /** Optional callback fired on every per-slide terminal
   *  transition. Useful for fine-grained logging or analytics. */
  onSlideSettled?: (result: SlideGenerationResult) => void;
}

export interface SlideGenerationResult {
  slideId: string;
  ok: boolean;
  /** When `ok === false`, the most recent error message. */
  error: string | null;
  /** Total LLM calls the queue made for this slide (content +
   *  html, retries included). */
  attempts: number;
}

export interface SlideGenerationSummary {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: boolean;
  results: SlideGenerationResult[];
}

export interface EnqueueAllOptions {
  /** Empty string (the default) means "use whatever default the
   *  HTML prompt suggests". Mirrors the previous sequential
   *  implementation, which also passed an empty string. */
  designInstructions?: string;
  /**
   * Phases the queue should drive for this batch. Defaults to
   * BOTH content and HTML — the "Generar todo" button. The
   * "Generar contenidos de todo" button (content-only) passes
   * `["content"]`. Custom order is supported but the first
   * phase should always be "content" because the HTML prompt
   * reads the content boxes to seed the layout.
   */
  phases?: ReadonlyArray<"content" | "html">;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

export class SlideGenerationQueue {
  private queue: string[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly onComplete:
    | ((summary: SlideGenerationSummary) => void)
    | undefined;
  private readonly onSlideSettled:
    | ((result: SlideGenerationResult) => void)
    | undefined;

  /**
   * Cancellation flag. Flipped by `cancel()`. The pump checks
   * this between dispatches; in-flight jobs finish their current
   * `await` and resolve with whatever the LLM call returned.
   */
  private cancelled = false;

  /**
   * Currently-running batch's promise. `enqueueAll` returns this
   * promise so the caller can `await` it for the completion
   * toast / revalidation. Calling `enqueueAll` again while a
   * batch is in flight returns the SAME promise (subsequent
   * calls are no-ops) — the FIFO is not extended, and a second
   * batch of slide ids would be ignored until the first one
   * settles. This prevents a double-click on "Generar todo" from
   * starting two parallel batches that race on the store.
   */
  private inFlight: Promise<SlideGenerationSummary> | null = null;
  private currentResults: SlideGenerationResult[] = [];
  /**
   * Map from slideId to its index in the input order. Populated
   * in `enqueueAll` and consulted by `recordResult` to write the
   * per-slide result into the right slot of `currentResults`
   * regardless of the order in which the FIFO dispatches them.
   * Without this map, the result for slide 2 (which finishes
   * first under concurrency > 1) would land at the END of the
   * array via `Array.push`, growing the array past `totalCount`
   * and breaking the summary's `total` field. The array is
   * still pre-allocated in `enqueueAll` so the fill-gaps loop
   * at the end of `runBatch` can detect "no result was recorded
   * for this input index" (cancellation skip case).
   */
  private currentIdToIndex: Map<string, number> = new Map();
  private currentTotal = 0;
  private resolved = false;

  constructor(
    private service: SlideGenerationService,
    private store: SlideGenerationStore,
    options: SlideGenerationQueueOptions = {}
  ) {
    this.concurrency = Math.max(
      1,
      options.concurrency ?? DEFAULT_CONCURRENCY
    );
    this.maxRetries = Math.max(1, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.onComplete = options.onComplete;
    this.onSlideSettled = options.onSlideSettled;
  }

  /** Signal the queue to stop dispatching new slides. Idempotent. */
  cancel(): void {
    this.cancelled = true;
  }

  /** True after `cancel()` has been called. */
  isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * Enqueue every slide for parallel generation. The returned
   * promise resolves when EVERY slide has reached a terminal
   * state (completed, failed, or skipped because of cancel).
   *
   * Calling `enqueueAll` while a previous batch is still in
   * flight returns the existing promise. This prevents
   * double-fires (e.g. the user clicking the button twice
   * while the first click is still being processed) from
   * stomping on each other.
   *
   * The store is initialised FIRST (so the UI sees the pending
   * state before the first LLM call goes out) and the pump is
   * kicked SECOND. We dedupe + freeze the input: the slides
   * client passes a fresh array on every render, but the queue
   * must not see future mutations of that array while the
   * batch is in flight.
   */
  enqueueAll(
    slideIds: readonly string[],
    options: EnqueueAllOptions = {}
  ): Promise<SlideGenerationSummary> {
    if (this.inFlight) {
      return this.inFlight;
    }
    this.cancelled = false;
    this.resolved = false;

    const ids = Array.from(new Set(slideIds));
    const designInstructions = options.designInstructions ?? "";
    const phases =
      options.phases && options.phases.length > 0
        ? options.phases
        : (["content", "html"] as const);
    this.currentTotal = ids.length;
    this.currentResults = new Array(ids.length);
    this.currentIdToIndex = new Map(ids.map((id, idx) => [id, idx] as const));

    if (ids.length === 0) {
      // Nothing to do, but still emit an empty summary so the
      // caller's `onComplete` runs (matches the contract).
      const empty: SlideGenerationSummary = {
        total: 0,
        succeeded: 0,
        failed: 0,
        cancelled: false,
        results: [],
      };
      this.inFlight = Promise.resolve(empty).then((s) => {
        this.onComplete?.(s);
        this.inFlight = null;
        return s;
      });
      return this.inFlight;
    }

    // Seed the store with `pending` rows for every requested
    // slide. This is the trigger that flips `isRunning` and
    // populates the global progress bar; the UI re-renders
    // before the first LLM call goes out.
    this.store.startGeneration(ids);

    this.queue.push(...ids);
    this.inFlight = this.runBatch(designInstructions, phases);
    return this.inFlight;
  }

  /**
   * Drains the FIFO + awaits every in-flight job. Resolves once
   * the queue is empty and `active === 0`. `enqueueAll` wraps
   * this in the inFlight promise that callers await.
   */
  private async runBatch(
    designInstructions: string,
    phases: ReadonlyArray<"content" | "html">
  ): Promise<SlideGenerationSummary> {
    // Spawn the first round of workers — each one drains the
    // FIFO until it's empty. The recursion bottoms out when the
    // queue is empty and no slots are active.
    this.processQueue(designInstructions, phases);

    // Poll for completion. The pump is event-driven (a
    // `processJob.finally` re-invokes `processQueue`), but the
    // outer "are we done?" check is simpler as a poll — we just
    // wait until both `queue` and `active` are zero. We use
    // microtask resolution to keep the loop tight without
    // burning CPU.
    while (this.queue.length > 0 || this.active > 0) {
      if (this.resolved) break;
      await this.delay(50);
    }

    // Fill any gap left by cancellation so the resulting array
    // has exactly one entry per requested id (in input order).
    // The cancellation drain in `processQueue` should have
    // populated every slot, but this is a belt-and-braces
    // fallback for the edge case where the cancel signal
    // arrived after all in-flight jobs completed normally.
    for (let i = 0; i < this.currentResults.length; i++) {
      if (!this.currentResults[i]) {
        // Find the slideId for this input index by reversing
        // the id → index map. Pre-allocated in `enqueueAll`.
        let slideId: string | undefined;
        for (const [id, idx] of this.currentIdToIndex) {
          if (idx === i) {
            slideId = id;
            break;
          }
        }
        if (!slideId) continue; // shouldn't happen
        const skipped: SlideGenerationResult = {
          slideId,
          ok: false,
          error: "Cancelado por el usuario",
          attempts: 0,
        };
        this.currentResults[i] = skipped;
        try {
          this.store.markFailed(slideId, skipped.error ?? "");
        } catch {
          // ignore
        }
        this.onSlideSettled?.(skipped);
      }
    }

    const succeeded = this.currentResults.filter((r) => r?.ok).length;
    const failed = this.currentResults.length - succeeded;
    const summary: SlideGenerationSummary = {
      total: this.currentResults.length,
      succeeded,
      failed,
      cancelled: this.cancelled,
      results: this.currentResults,
    };
    this.resolved = true;
    this.inFlight = null;
    this.onComplete?.(summary);
    return summary;
  }

  /**
   * Drain the FIFO into the active slot pool. The loop
   * terminates when either the queue is empty or no slots are
   * free — a terminating condition is necessary because
   * `processJob` is non-blocking: a single call to
   * `processQueue` must fill the pool in one pass, otherwise
   * we'd spin waiting for promises that haven't resolved yet.
   */
  private processQueue(
    designInstructions: string,
    phases: ReadonlyArray<"content" | "html">
  ): void {
    // Cancellation path: drain the FIFO by marking every
    // remaining slide as failed. Without this, the runBatch
    // poll loop would never see `queue.length === 0` (it
    // stops dispatching new work but leaves the FIFO intact)
    // and the batch promise would hang forever.
    if (this.cancelled) {
      while (this.queue.length > 0) {
        const slideId = this.queue.shift()!;
        const skipped: SlideGenerationResult = {
          slideId,
          ok: false,
          error: "Cancelado por el usuario",
          attempts: 0,
        };
        this.recordResult(slideId, skipped);
        // Mark the slide as failed in the store so the UI
        // flips to the red state. Best-effort — a slide that
        // wasn't in the store (shouldn't happen, but
        // defensive) is silently ignored.
        try {
          this.store.markFailed(slideId, skipped.error ?? "");
        } catch {
          // ignore
        }
      }
      return;
    }

    while (
      this.queue.length > 0 &&
      this.active < this.concurrency
    ) {
      const slideId = this.queue.shift()!;
      this.active++;
      // Fire-and-forget: the .finally hook frees the slot and
      // re-pumps. Awaiting here would cap concurrency at 1
      // because the first awaited job would block the rest.
      this.processJob(slideId, designInstructions, phases)
        .catch(() => {
          // processJob already routes errors to markFailed.
          // This catch is a defensive net so an unexpected throw
          // (e.g. from the store) doesn't crash the pump.
        })
        .finally(() => {
          this.active--;
          // Always re-invoke the pump from the .finally so
          // the cancellation path can drain the FIFO. The
          // pump itself checks `this.cancelled` and routes
          // remaining items to `markFailed` instead of
          // dispatching new jobs.
          this.processQueue(designInstructions, phases);
        });
    }
  }

  /**
   * Process a single job: content phase → HTML phase. Each
   * phase is retried up to `maxRetries` times. A failing content
   * phase short-circuits the job (no HTML); a failing HTML phase
   * surfaces a `failed` status for the slide.
   *
   * The store is updated at three well-defined points so the UI
   * can show progress and retries without polling:
   *   - entering each phase (`updateJob`)
   *   - on success (`markCompleted`)
   *   - on exhaustion (`markFailed`)
   */
  private async processJob(
    slideId: string,
    designInstructions: string,
    phases: ReadonlyArray<"content" | "html">
  ): Promise<SlideGenerationResult> {
    let attempts = 0;
    // Step 1: Generate content (with retry). Always first — the
    // HTML prompt reads the content boxes to seed the layout,
    // so running HTML on an empty slide would produce a
    // near-empty page.
    if (phases.includes("content")) {
      const contentOk = await this.runPhase(
        slideId,
        "content",
        () => this.service.generateSlideContent(slideId)
      );
      attempts += 1;
      if (!contentOk) {
        const result: SlideGenerationResult = {
          slideId,
          ok: false,
          error: "La generación de contenido excedió el número de reintentos",
          attempts,
        };
        this.recordResult(slideId, result);
        return result;
      }
    }

    // Step 2: Generate HTML (only after content is done, and
    // only if the caller asked for it).
    if (phases.includes("html")) {
      const htmlOk = await this.runPhase(slideId, "html", () =>
        this.service.regenerateHtmlDesign(slideId, designInstructions)
      );
      attempts += 1;
      if (!htmlOk) {
        const result: SlideGenerationResult = {
          slideId,
          ok: false,
          error: "La generación de HTML excedió el número de reintentos",
          attempts,
        };
        this.recordResult(slideId, result);
        return result;
      }
    }

    const ok: SlideGenerationResult = {
      slideId,
      ok: true,
      error: null,
      attempts,
    };
    this.recordResult(slideId, ok);
    // Notify the store that the slide is fully generated. The
    // store flips `isRunning` to false once every job has
    // reached a terminal state, which is what dismisses the
    // global progress bar.
    this.store.markCompleted(slideId);
    return ok;
  }

  /**
   * Run a single phase with retry. Updates the store to
   * `generating_<phase>` before each attempt, increments the
   * retry counter via `updateJob({ retries: ... })`, and flips
   * to `failed` (without throwing) when the budget is exhausted.
   */
  private async runPhase(
    slideId: string,
    phase: "content" | "html",
    op: () => Promise<unknown>
  ): Promise<boolean> {
    let lastErrorMessage: string | null = null;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      if (this.cancelled) {
        // Don't keep the server busy while the user is trying
        // to back out. We DON'T mark the slide as failed here
        // — runBatch stamps the cancellation reason on the
        // summary, and the slides page surfaces it.
        return false;
      }
      this.store.updateJob(slideId, {
        status:
          phase === "content" ? "generating_content" : "generating_html",
        phase,
        retries: attempt - 1,
      });
      try {
        await op();
        return true;
      } catch (err) {
        lastErrorMessage =
          err instanceof Error ? err.message : String(err);
        this.store.updateJob(slideId, {
          status:
            phase === "content" ? "generating_content" : "generating_html",
          phase,
          retries: attempt,
          error: lastErrorMessage,
        });
        if (attempt < this.maxRetries) {
          await this.delay(this.retryDelayMs);
        }
      }
    }
    this.store.markFailed(
      slideId,
      lastErrorMessage ?? "Error desconocido"
    );
    return false;
  }

  private recordResult(slideId: string, result: SlideGenerationResult): void {
    // Look up the input index by slideId. Pre-allocated in
    // `enqueueAll` so the slot always exists. If a slideId is
    // not in the map (e.g. the result was generated for a
    // slide the user added AFTER the batch started — not
    // expected in practice but defensive), fall through to a
    // no-op rather than corrupting the array.
    const idx = this.currentIdToIndex.get(slideId);
    if (idx === undefined) {
      // Defensive: log so we can spot the regression in
      // development. Production: swallow.
      if (typeof console !== "undefined") {
        console.warn(
          `[SlideGenerationQueue] recordResult: unknown slideId "${slideId}"`
        );
      }
      return;
    }
    this.currentResults[idx] = result;
    this.onSlideSettled?.(result);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

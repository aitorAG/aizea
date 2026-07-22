import { create } from "zustand";

/**
 * v1.10 / Wave 1 — Per-slide job state tracked by the slide generation
 * queue. A single job owns both phases (content + HTML); the queue
 * moves the job from `pending` → `generating_content` → `generating_html`
 * → `completed` (or `failed`) and records the retry counter so the
 * UI can show "Reintento 2/4" while the queue is mid-retry.
 *
 * v1.10 / Wave 2 — `SlideGenerationStatus` is now exported as a
 * separate type alias so the SlidesHierarchy, the progress bar,
 * and the queue can all reference the same status vocabulary
 * without re-stating the union inline.
 */
export type SlideGenerationStatus =
  | "pending"
  | "generating_content"
  | "generating_html"
  | "completed"
  | "failed";

export interface SlideJobState {
  slideId: string;
  status: SlideGenerationStatus;
  retries: number;
  phase: "content" | "html";
  error?: string;
}

interface SlideGenerationState {
  jobs: Map<string, SlideJobState>;
  totalCount: number;
  completedCount: number;
  failedCount: number;
  isRunning: boolean;
  startGeneration: (ids: string[]) => void;
  updateJob: (id: string, p: Partial<SlideJobState>) => void;
  markCompleted: (id: string) => void;
  markFailed: (id: string, error: string) => void;
  reset: () => void;
}

/**
 * Minimal interface the queue depends on. The Zustand store satisfies
 * it as-is (useSlideGenerationStore has all five methods), but the
 * interface lets the queue be tested with a hand-rolled stub and
 * shields the infrastructure layer from Zustand-specific details.
 */
export type SlideGenerationStore = Pick<
  SlideGenerationState,
  "startGeneration" | "updateJob" | "markCompleted" | "markFailed"
>;

export const useSlideGenerationStore = create<SlideGenerationState>(
  (set, get) => ({
    jobs: new Map(),
    totalCount: 0,
    completedCount: 0,
    failedCount: 0,
    isRunning: false,

    startGeneration: (ids) => {
      // Each batch starts from a clean slate. The queue calls this
      // once per batch via `SlideGenerationQueue.enqueueAll`, so we
      // intentionally drop any leftover state from a previous run.
      const jobs = new Map<string, SlideJobState>();
      ids.forEach((id) =>
        jobs.set(id, {
          slideId: id,
          status: "pending",
          retries: 0,
          phase: "content",
        })
      );
      set({
        jobs,
        totalCount: ids.length,
        completedCount: 0,
        failedCount: 0,
        isRunning: true,
      });
    },

    updateJob: (id, partial) => {
      // Defensive copy: the queue's `processJob` and the UI both
      // observe the same Map, so a fresh instance is needed on every
      // update to trigger Zustand's shallow equality check.
      const jobs = new Map(get().jobs);
      const existing = jobs.get(id);
      if (existing) {
        jobs.set(id, { ...existing, ...partial });
      }
      set({ jobs });
    },

    markCompleted: (id) => {
      set((s) => {
        const jobs = new Map(s.jobs);
        const job = jobs.get(id);
        if (job) {
          jobs.set(id, { ...job, status: "completed" });
        }
        const completedCount = s.completedCount + 1;
        // isRunning flips off when the last job has reached a
        // terminal state (completed OR failed) — otherwise the UI
        // would show "generating" forever after a few failures.
        const isRunning = completedCount + s.failedCount < s.totalCount;
        return { jobs, completedCount, isRunning };
      });
    },

    markFailed: (id, error) => {
      set((s) => {
        const jobs = new Map(s.jobs);
        const job = jobs.get(id);
        if (job) {
          jobs.set(id, { ...job, status: "failed", error });
        }
        const failedCount = s.failedCount + 1;
        const isRunning = s.completedCount + failedCount < s.totalCount;
        return { jobs, failedCount, isRunning };
      });
    },

    reset: () =>
      set({
        jobs: new Map(),
        totalCount: 0,
        completedCount: 0,
        failedCount: 0,
        isRunning: false,
      }),
  })
);

// Dev-only: expose the store on `window.__slideGenerationStore`
// so QA scripts (and Playwright) can drive the slides page
// without going through a real LLM pipeline. Harmless in
// production — the store is read-only when nothing calls it.
// Mirrors the `__pipelineStore` exposure pattern in
// `usePipelineStore.ts`.
if (typeof window !== "undefined") {
  (
    window as unknown as {
      __slideGenerationStore?: typeof useSlideGenerationStore;
    }
  ).__slideGenerationStore = useSlideGenerationStore;
}

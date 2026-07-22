import { create } from "zustand";

// jobs-ui-store — tiny UI-only store that drives the v1.11 Jobs
// sidebar. Lives apart from `useUIStore` so the global export
// modal and the tabs state are unaffected, and so future Jobs
// affordances (e.g. a "Go to job" anchor link) can be added here
// without polluting the rest of the app.
//
// Why a store (and not prop-drilling / context)?
//   - The trigger lives in `app/layout.tsx` (the nav bar). The
//     drawer lives in `app/layout.tsx` too, but a single store
//     means the trigger can be invoked from anywhere — e.g. a
//     future "View all jobs" button on the dashboard.
//   - The drawer needs to know how many ACTIVE jobs are running
//     globally so the nav button can show a badge. The store
//     carries the count separately from the `open` flag so the
//     nav button doesn't have to mount the drawer to know.

interface JobsUIState {
  /** Whether the right-side Jobs drawer is open. */
  isOpen: boolean;
  /** Total active jobs (across all courses) — drives the badge
   *  on the nav button without mounting the drawer. */
  activeCount: number;
}

interface JobsUIActions {
  open: () => void;
  close: () => void;
  toggle: () => void;
  setActiveCount: (count: number) => void;
}

export const useJobsUIStore = create<JobsUIState & JobsUIActions>((set) => ({
  isOpen: false,
  activeCount: 0,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  setActiveCount: (count) => set({ activeCount: count }),
}));

// Dev-only: expose the store on `window.__jobsUIStore` so QA
// scripts / Playwright can open or close the drawer without going
// through a real user click. Mirrors the `__pipelineStore` and
// `__slideGenerationStore` exposure patterns.
if (typeof window !== "undefined") {
  (
    window as unknown as { __jobsUIStore?: typeof useJobsUIStore }
  ).__jobsUIStore = useJobsUIStore;
}

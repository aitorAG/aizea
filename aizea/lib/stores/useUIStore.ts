import { create } from "zustand";

type Tab = "materials" | "slides" | "figures";

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant?: "success" | "error" | "info";
}

interface UIState {
  activeTab: Tab;
  isExportModalOpen: boolean;
  toasts: Toast[];
}

interface UIActions {
  setActiveTab: (tab: Tab) => void;
  openExportModal: () => void;
  closeExportModal: () => void;
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  activeTab: "slides",
  isExportModalOpen: false,
  toasts: [],

  setActiveTab: (activeTab) => set({ activeTab }),

  openExportModal: () => set({ isExportModalOpen: true }),

  closeExportModal: () => set({ isExportModalOpen: false }),

  addToast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        { ...toast, id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}` },
      ],
    })),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

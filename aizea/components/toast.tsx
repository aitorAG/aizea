"use client";

import { create } from "zustand";
import { X, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { genId } from "@/lib/utils/gen-id";
import { useEffect } from "react";

type ToastVariant = "success" | "error" | "info";

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = genId();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
  },
  removeToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

function toast({
  title,
  description,
  variant = "info",
}: {
  title: string;
  description?: string;
  variant?: ToastVariant;
}) {
  useToastStore.getState().addToast({ title, description, variant });
}

const variantStyles: Record<ToastVariant, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  error: "border-red-200 bg-red-50 text-red-900",
  info: "border-sky-200 bg-sky-50 text-sky-900",
};

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />,
  error: <AlertCircle className="h-4 w-4 text-red-600 shrink-0" />,
  info: <Info className="h-4 w-4 text-sky-600 shrink-0" />,
};

function ToastItem({ toast: t }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);

  useEffect(() => {
    const timer = setTimeout(() => removeToast(t.id), 4000);
    return () => clearTimeout(timer);
  }, [t.id, removeToast]);

  return (
    <div
      className={cn(
        "pointer-events-auto flex w-80 items-start gap-3 rounded-lg border p-4 shadow-lg animate-in slide-in-from-bottom-5 fade-in duration-300",
        variantStyles[t.variant]
      )}
      role="alert"
    >
      {variantIcons[t.variant]}
      <div className="flex-1 space-y-0.5">
        <p className="text-sm font-semibold leading-none">{t.title}</p>
        {t.description && (
          <p className="text-xs opacity-80 mt-1">{t.description}</p>
        )}
      </div>
      <button
        onClick={() => removeToast(t.id)}
        className="shrink-0 rounded-sm p-0.5 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="Cerrar notificación"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Toaster() {
  const toasts = useToastStore((s) => s.toasts);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function useToast() {
  const addToast = useToastStore((s) => s.addToast);
  return {
    toast: ({
      title,
      description,
      variant = "info",
    }: {
      title: string;
      description?: string;
      variant?: ToastVariant;
    }) => addToast({ title, description, variant }),
  };
}

export { Toaster, useToast, toast };
export type { ToastVariant };
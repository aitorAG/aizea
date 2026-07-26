"use client";

// Reusable React error boundary (Fase 4 — error boundaries).
//
// The app had NO error boundaries: any render-time throw in a client
// component would blank the whole tree with React's default overlay (dev) or a
// silent white screen (prod). This boundary catches render/lifecycle errors in
// its subtree, shows a recoverable fallback, and lets the user retry WITHOUT a
// full reload — the core of the Fase 4 "error boundaries" objective.
//
// It is a class component because `getDerivedStateFromError` /
// `componentDidCatch` have no hook equivalent. The Next App Router
// `error.tsx` / `global-error.tsx` files reuse the SAME fallback UI so the
// route-level and component-level behaviour stay consistent.

import React from "react";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Custom fallback renderer. Receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
  /** Side-effect on catch (logging/telemetry). */
  onError?: (error: Error, info: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Best-effort: a logging failure must never mask the original error.
    try {
      this.props.onError?.(error, info);
    } catch {
      /* swallow */
    }
    console.error("[ErrorBoundary] caught:", error);
  }

  reset(): void {
    this.setState({ error: null });
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) {
        return this.props.fallback(error, this.reset);
      }
      return <DefaultErrorFallback error={error} reset={this.reset} />;
    }
    return this.props.children;
  }
}

export function DefaultErrorFallback({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}): React.ReactElement {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-red-300 bg-red-50 p-6 text-center"
    >
      <h2 className="text-lg font-semibold text-red-800">Algo salió mal</h2>
      <p className="max-w-md text-sm text-red-700">
        {error.message || "Se produjo un error inesperado."}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
      >
        Reintentar
      </button>
    </div>
  );
}

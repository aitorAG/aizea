"use client";

import { forwardRef, useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  autoResize?: boolean;
  label?: string;
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, autoResize = false, label, error, id, onInput, ...props }, ref) => {
    const internalRef = useRef<HTMLTextAreaElement>(null);

const handleInput = useCallback(
    (e: React.InputEvent<HTMLTextAreaElement>) => {
      if (autoResize) {
        const target = e.currentTarget;
        target.style.height = "auto";
        target.style.height = `${target.scrollHeight}px`;
      }
      onInput?.(e);
    },
    [autoResize, onInput]
  );

    const setRefs = useCallback(
      (node: HTMLTextAreaElement | null) => {
        if (typeof ref === "function") {
          ref(node);
        } else if (ref) {
          (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
        }
        (internalRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      },
      [ref]
    );

    return (
      <div className="space-y-1.5">
        {label && (
          <label
            htmlFor={id}
            className="block text-sm font-medium text-foreground"
          >
            {label}
          </label>
        )}
        <textarea
          id={id}
          className={cn(
            "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50",
            error && "border-destructive focus-visible:ring-destructive",
            className
          )}
          ref={setRefs}
          onInput={handleInput}
          {...props}
        />
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
export type { TextareaProps };
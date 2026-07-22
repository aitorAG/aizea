"use client";

// InlineTreeNodeEditor — the inline-edit form for a freshly-created
// tree node. Lives in its own component so the state machine
// (editing / saving / saved / error) is isolated and easy to test.
//
// Why a separate component:
//   - The TreeNode already has a complex state machine (hover brief
//     → full → idle) and a multi-checkbox selection surface. Adding
//     a second state machine there would be too many concerns in
//     one component.
//   - The editor is the same shape for both "Añadir raíz" and
//     "Añadir hijo" — extracting it makes that contract obvious.
//
// State machine:
//   - `editing` (initial) — the user sees the inputs. Pressing
//     Enter or blurring either field commits the values via
//     `onSave`. Pressing Escape reverts to the draft values.
//   - `saving` — `onSave` is in flight. The inputs are disabled and
//     show a small spinner. After the promise resolves the editor
//     leaves `editing` only if the server accepted the change (the
//     parent will re-render us with a non-`isNew` node, see below).
//   - `saved` — shown briefly ("Guardado" indicator) after a
//     successful save. The editor stays mounted but the indicator
//     fades.
//
// Why autoFocus on the description (not the name):
//   - The server already created the node with a sensible default
//     name ("Nuevo nodo") so the name is rarely the first thing the
//     user wants to type. The description is the high-leverage
//     field — it's the prompt the slide generator will eventually
//     read. We autoFocus the description so the user can start
//     describing the box's content right away.
//
// Why save on Enter AND blur:
//   - Enter is the standard "I'm done" affordance for a single-line
//     description. Blur covers the case where the user clicks
//     elsewhere on the page — the values should not be lost.
//   - We do NOT save on every keystroke (the slide generator path
//     is idempotent but writing on every char is wasteful and
//     causes input lag in ReactFlow renders).

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface InlineTreeNodeEditorProps {
  initialName: string;
  initialSummary: string | null;
  onSave: (values: {
    name: string;
    summary: string | null;
  }) => Promise<void>;
}

const SAVE_INDICATOR_MS = 1500;

export function InlineTreeNodeEditor({
  initialName,
  initialSummary,
  onSave,
}: InlineTreeNodeEditorProps) {
  const [name, setName] = useState(initialName);
  const [summary, setSummary] = useState(initialSummary ?? "");
  // `dirty` is true once the user has changed the name or summary
  // from their initial values. The blur-save handler below only
  // commits when dirty — otherwise the very first interaction
  // (clicking the name input while the description is autoFocused)
  // would trigger a save with the unchanged default values,
  // which is confusing in real UX and a flake risk in tests.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descRef = useRef<HTMLInputElement | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // AutoFocus the description input on mount. The user can Tab to
  // the name if they want to rename; the description is the
  // high-leverage field.
  useEffect(() => {
    descRef.current?.focus();
  }, []);

  // Cleanup the saved-flash timer on unmount.
  useEffect(() => {
    return () => {
      if (savedTimerRef.current !== null) {
        clearTimeout(savedTimerRef.current);
        savedTimerRef.current = null;
      }
    };
  }, []);

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setName(e.target.value);
      setDirty(true);
    },
    []
  );

  const handleSummaryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSummary(e.target.value);
      setDirty(true);
    },
    []
  );

  // Commit both fields. Returns true on success, false on failure
  // (so the caller can decide whether to clear the saving flag).
  const commit = useCallback(async () => {
    const trimmedName = name.trim();
    // The server rejects empty names; we keep the user in the
    // editor so they can fix it instead of silently dropping the
    // change. Defensive: the parent's UI also disables save when
    // the name is empty.
    if (trimmedName.length === 0) {
      setError("El nombre no puede estar vacío.");
      return false;
    }
    setError(null);
    setSaving(true);
    try {
      await onSave({
        name: trimmedName,
        summary: summary.trim().length === 0 ? null : summary.trim(),
      });
      // Show the "Guardado" indicator briefly. The parent will
      // eventually remove this id from its "recently added" set,
      // unmounting the editor; if it takes longer, the user gets
      // immediate visual feedback.
      setSavedFlash(true);
      if (savedTimerRef.current !== null) {
        clearTimeout(savedTimerRef.current);
      }
      savedTimerRef.current = setTimeout(() => {
        setSavedFlash(false);
        savedTimerRef.current = null;
      }, SAVE_INDICATOR_MS);
      return true;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo guardar el cambio."
      );
      return false;
    } finally {
      setSaving(false);
    }
  }, [name, summary, onSave]);

  // Blur handler for the description input. Only commit when the
  // user has actually typed something (the `dirty` guard). This
  // prevents the autoFocus → user-clicks-name → blur-on-description
  // sequence from triggering a save with the initial values.
  const handleSummaryBlur = useCallback(() => {
    if (!saving && dirty) {
      void commit();
    }
  }, [saving, dirty, commit]);

  const handleSummaryKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Commit on Enter. The parent re-renders us with `isNew=false`
        // when the nodes list updates, which unmounts the editor.
        void commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        // Revert to the original values.
        setName(initialName);
        setSummary(initialSummary ?? "");
        setError(null);
      }
    },
    [commit, initialName, initialSummary]
  );

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        // Enter on the name field commits the current draft. The
        // user can keep editing (the editor stays mounted until
        // the parent removes the id from the "recently added" set
        // or the TTL expires). We don't move focus to the
        // description because that would also re-fire the
        // description's Enter handler via the same key event.
        void commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setName(initialName);
        setSummary(initialSummary ?? "");
        setError(null);
      }
    },
    [commit, initialName, initialSummary]
  );

  return (
    <div
      data-testid="inline-tree-node-editor"
      data-saving={saving ? "true" : "false"}
      data-saved={savedFlash ? "true" : "false"}
      // Stop pointer events on the editor from bubbling up to the
      // parent TreeNode / ReactFlow, otherwise clicking inside the
      // input would also toggle the F4.1 selection or fire the
      // body click handler.
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="space-y-1.5"
    >
      <input
        type="text"
        value={name}
        onChange={handleNameChange}
        onKeyDown={handleNameKeyDown}
        disabled={saving}
        placeholder="Nombre del nodo"
        aria-label="Nombre del nodo"
        data-testid="inline-tree-node-name-input"
        className={cn(
          "h-7 w-full rounded border border-input bg-background px-2 text-sm font-medium",
          "shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      />
      <input
        ref={descRef}
        type="text"
        value={summary}
        onChange={handleSummaryChange}
        onKeyDown={handleSummaryKeyDown}
        onBlur={handleSummaryBlur}
        disabled={saving}
        placeholder="Describe el contenido de esta caja"
        aria-label="Describe el contenido de esta caja"
        data-testid="inline-tree-node-summary-input"
        className={cn(
          "h-7 w-full rounded border border-dashed border-input bg-background/60 px-2 text-xs text-muted-foreground",
          "shadow-sm transition-colors",
          "placeholder:text-muted-foreground/70 placeholder:italic",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "focus-visible:border-primary",
          "disabled:cursor-not-allowed disabled:opacity-50"
        )}
      />
      <div className="flex h-3 items-center justify-between font-mono text-[9px] uppercase tracking-wider">
        {error ? (
          <span
            data-testid="inline-tree-node-error"
            className="text-destructive"
            role="alert"
          >
            {error}
          </span>
        ) : saving ? (
          <span
            data-testid="inline-tree-node-saving"
            className="flex items-center gap-1 text-muted-foreground"
          >
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            Guardando
          </span>
        ) : savedFlash ? (
          <span
            data-testid="inline-tree-node-saved"
            className="flex items-center gap-1 text-emerald-600"
          >
            <Check className="h-2.5 w-2.5" />
            Guardado
          </span>
        ) : (
          <span className="text-muted-foreground/60">
            Enter / Tab para guardar
          </span>
        )}
      </div>
    </div>
  );
}

export default InlineTreeNodeEditor;

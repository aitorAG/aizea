"use client";

// SlideTitleField — F5.2 inline title/description editor.
//
// Why this lives in its own component:
//   - The slide detail page already has a LOT going on: HTML preview,
//     design instructions, 5 box editors, generation actions, modal
//     preview. Tucking the title editor into its own component keeps
//     the read-only → edit → saving → read-only state machine
//     isolated and easy to test.
//   - "Other editable properties (title, content of the boxes)" was
//     missing from the original implementation. Pinning the contract
//     in tests/unit/slide-title-field.test.tsx means a regression
//     that removes the title editor will fail loudly.
//
// State machine:
//   - readOnly (initial) → click Editar → editing → click Guardar →
//     onSave() promise pending → onSave resolves → readOnly (with the
//     new values from props, since the server is the source of truth).
//   - At any point during "editing" the user can click Cancelar to
//     discard the draft and return to readOnly.
//   - When `saving` is true (prop, owned by the parent) we show a
//     spinner and disable the Editar button. This handles the case
//     where the user clicks Editar and then the parent kicks off a
//     server action — the user can't double-open the editor while
//     one is in flight.

import { useState, useEffect } from "react";
import { Edit, Save, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SlideTitleFieldProps {
  title: string;
  description: string;
  /** Async — the parent owns the server action. */
  onSave: (values: { title: string; description: string }) => Promise<void>;
  /** Disables the Editar button while a save is in flight. */
  saving?: boolean;
}

export function SlideTitleField({
  title,
  description,
  onSave,
  saving = false,
}: SlideTitleFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftDescription, setDraftDescription] = useState(description);
  const [submitting, setSubmitting] = useState(false);

  // Re-sync the local draft when the upstream values change. This
  // matters when the user navigates to a different slide via the
  // SlideNavigator — the parent re-renders with new props, and the
  // title field must follow (instead of showing the previous slide's
  // title).
  useEffect(() => {
    if (!editing) {
      setDraftTitle(title);
      setDraftDescription(description);
    }
  }, [title, description, editing]);

  function openEditor() {
    if (saving) return;
    setDraftTitle(title);
    setDraftDescription(description);
    setEditing(true);
  }

  function cancel() {
    setDraftTitle(title);
    setDraftDescription(description);
    setEditing(false);
  }

  async function save() {
    const trimmed = draftTitle.trim();
    if (!trimmed) return; // disabled in UI; defensive guard
    setSubmitting(true);
    try {
      await onSave({ title: trimmed, description: draftDescription });
      // Only exit edit mode on a successful save. The parent is
      // expected to re-render us with the new title prop; the
      // useEffect above will then drop us out of edit mode by
      // re-syncing the draft.
      setEditing(false);
    } finally {
      setSubmitting(false);
    }
  }

  const isBusy = saving || submitting;
  const canSave = draftTitle.trim().length > 0 && !isBusy;

  if (!editing) {
    return (
      <div
        data-testid="slide-title-field"
        data-state="read-only"
        className="min-w-0"
      >
        <div className="flex items-center gap-2">
          <h1
            data-testid="slide-title-heading"
            className="truncate text-xl font-bold tracking-tight"
          >
            {title}
          </h1>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={openEditor}
            disabled={saving}
            aria-label="Editar título y descripción"
            data-testid="slide-title-edit-button"
            className="h-7 gap-1 px-2 text-xs"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Edit className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Editar</span>
          </Button>
        </div>
        {description && (
          <p
            data-testid="slide-title-description"
            className="mt-1 text-sm text-muted-foreground"
          >
            {description}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="slide-title-field"
      data-state="editing"
      className="space-y-3 rounded-md border border-border bg-muted/30 p-3"
    >
      <Input
        id="slide-title-input-id"
        label="Título"
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        disabled={isBusy}
        data-testid="slide-title-input"
        placeholder="Título de la diapositiva"
        autoFocus
      />
      <Textarea
        id="slide-description-input-id"
        label="Descripción"
        value={draftDescription}
        onChange={(e) => setDraftDescription(e.target.value)}
        disabled={isBusy}
        data-testid="slide-description-input"
        placeholder="Descripción breve"
        rows={2}
      />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={cancel}
          disabled={isBusy}
          data-testid="slide-title-cancel-button"
        >
          <X className="h-3.5 w-3.5" />
          Cancelar
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={!canSave}
          data-testid="slide-title-save-button"
        >
          {submitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          Guardar
        </Button>
      </div>
    </div>
  );
}

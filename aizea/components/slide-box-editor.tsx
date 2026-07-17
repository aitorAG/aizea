"use client";

import { useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownKatex } from "@/components/markdown-katex";
import { Edit, Save, X } from "lucide-react";
import { BoxType } from "@/lib/types";

interface SlideBoxEditorProps {
  type: BoxType;
  content: string;
  onSave: (type: BoxType, content: string) => Promise<void>;
}

const boxConfig: Record<BoxType, { icon: string; label: string; description: string }> = {
  [BoxType.SCRIPT]: {
    icon: "🎯",
    label: "Concepto",
    description: "Guion del concepto a representar",
  },
  [BoxType.RELEVANCE]: {
    icon: "💡",
    label: "Relevancia",
    description: "Por qué es relevante este concepto",
  },
  [BoxType.NARRATIVE]: {
    icon: "📖",
    label: "Narrativa",
    description: "Narrativa para impartir en clase",
  },
  [BoxType.EXERCISE_1]: {
    icon: "✏️",
    label: "Ejercicio 1",
    description: "Enunciado de ejercicio",
  },
  [BoxType.EXERCISE_2]: {
    icon: "✏️",
    label: "Ejercicio 2",
    description: "Enunciado de ejercicio",
  },
};

function SlideBoxEditor({ type, content, onSave }: SlideBoxEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);

  const config = boxConfig[type];

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(type, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setDraft(content);
    setEditing(false);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
        <div>
          <h3 className="text-sm font-semibold leading-none">
            <span className="mr-1.5">{config.icon}</span>
            {config.label}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{config.description}</p>
        </div>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setDraft(content);
              setEditing(true);
            }}
          >
            <Edit className="h-3 w-3" />
            Editar
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <div className="space-y-3">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={8}
              className="font-mono text-sm"
              placeholder={`Escribe el contenido de ${config.label.toLowerCase()}...`}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                <X className="h-3.5 w-3.5" />
                Cancelar
              </Button>
              <Button size="sm" onClick={handleSave} loading={saving}>
                <Save className="h-3.5 w-3.5" />
                Guardar
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-h-[60px] rounded-md border border-border/50 bg-muted/20 p-3">
            <MarkdownKatex content={content} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { SlideBoxEditor };
export type { SlideBoxEditorProps };
export { BoxType };
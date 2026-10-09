"use client";

import { useState } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownKatex } from "@/components/markdown-katex";
import { Edit, Save, X } from "lucide-react";
import { BoxType } from "@/lib/types";
import { useTranslations } from "@/components/LocaleProvider";

interface SlideBoxEditorProps {
  type: BoxType;
  content: string;
  onSave: (type: BoxType, content: string) => Promise<void>;
}

const boxConfig: Record<BoxType, { icon: string; labelKey: "slides.script" | "slides.relevance" | "slides.narrative" | "slides.exerciseOne" | "slides.exerciseTwo" }> = {
  [BoxType.SCRIPT]: {
    icon: "🎯",
    labelKey: "slides.script",
  },
  [BoxType.RELEVANCE]: {
    icon: "💡",
    labelKey: "slides.relevance",
  },
  [BoxType.NARRATIVE]: {
    icon: "📖",
    labelKey: "slides.narrative",
  },
  [BoxType.EXERCISE_1]: {
    icon: "✏️",
    labelKey: "slides.exerciseOne",
  },
  [BoxType.EXERCISE_2]: {
    icon: "✏️",
    labelKey: "slides.exerciseTwo",
  },
};

function SlideBoxEditor({ type, content, onSave }: SlideBoxEditorProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const t = useTranslations();

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
            {t(config.labelKey)}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("slides.designInstructionsHint")}</p>
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
            {t("common.edit")}
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
              placeholder={t("slides.optionalDescriptionPlaceholder")}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                <X className="h-3.5 w-3.5" />
                {t("common.cancel")}
              </Button>
              <Button size="sm" onClick={handleSave} loading={saving}>
                <Save className="h-3.5 w-3.5" />
                {t("common.save")}
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

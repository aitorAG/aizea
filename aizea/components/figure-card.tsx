"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Image as ImageIcon, X } from "lucide-react";

interface FigureCardProps {
  id: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
  tags: string[];
  onUpdate: (id: string, data: { caption?: string; tags?: string[] }) => Promise<void>;
  onClick?: () => void;
}

function FigureCard({ id, filename, caption, pageNum, tags, onUpdate, onClick }: FigureCardProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [editCaption, setEditCaption] = useState(caption ?? "");
  const [editTags, setEditTags] = useState(tags);
  const [newTag, setNewTag] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate(id, { caption: editCaption, tags: editTags });
      setDetailOpen(false);
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const tag = newTag.trim();
    if (tag && !editTags.includes(tag)) {
      setEditTags([...editTags, tag]);
      setNewTag("");
    }
  }

  function removeTag(tag: string) {
    setEditTags(editTags.filter((t) => t !== tag));
  }

  return (
    <>
      <Card
        className="group cursor-pointer transition-shadow hover:shadow-md"
        onClick={() => {
          setEditCaption(caption ?? "");
          setEditTags([...tags]);
          setDetailOpen(true);
          onClick?.();
        }}
      >
        <CardContent className="p-4">
          <div className="flex h-32 items-center justify-center rounded-md bg-muted mb-3">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium line-clamp-1">{caption ?? filename}</p>
          {pageNum && (
            <p className="text-xs text-muted-foreground mt-0.5">Página {pageNum}</p>
          )}
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.slice(0, 3).map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
              {tags.length > 3 && (
                <Badge variant="outline" className="text-[10px]">
                  +{tags.length - 3}
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={detailOpen} onClose={() => setDetailOpen(false)}>
        <DialogHeader>
          <DialogTitle>Detalle de figura</DialogTitle>
          <DialogDescription>
            {filename}
            {pageNum && ` — Página ${pageNum}`}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <div className="flex h-48 items-center justify-center rounded-md bg-muted">
            <ImageIcon className="h-12 w-12 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="figure-caption" className="block text-sm font-medium text-foreground">
              Descripción
            </label>
            <Textarea
              id="figure-caption"
              value={editCaption}
              onChange={(e) => setEditCaption(e.target.value)}
              rows={3}
              placeholder="Describe la figura..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">Etiquetas</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {editTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="ml-0.5 rounded-full p-0.5 hover:bg-secondary-foreground/10"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Nueva etiqueta"
                className="flex-1"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button size="sm" onClick={addTag} variant="outline">
                Añadir
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDetailOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Guardar cambios
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

export { FigureCard };
export type { FigureCardProps };
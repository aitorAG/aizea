"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Edit, Trash2 } from "lucide-react";

interface SlideCardProps {
  id: string;
  order: number;
  title: string;
  description: string;
  onEdit: (id: string, title: string, description: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function SlideCard({ id, order, title, description, onEdit, onDelete }: SlideCardProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editTitle, setEditTitle] = useState(title);
  const [editDesc, setEditDesc] = useState(description);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleSave() {
    if (!editTitle.trim()) return;
    setSaving(true);
    try {
      await onEdit(id, editTitle.trim(), editDesc.trim());
      setEditOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await onDelete(id);
      setDeleteOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Card className="group transition-shadow hover:shadow-sm">
        <CardContent className="flex items-start gap-3 p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {order}
          </span>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-medium leading-tight line-clamp-1">{title}</h4>
            {description && (
              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{description}</p>
            )}
          </div>
          <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => {
                setEditTitle(title);
                setEditDesc(description);
                setEditOpen(true);
              }}
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={editOpen} onClose={() => setEditOpen(false)}>
        <DialogHeader>
          <DialogTitle>Editar diapositiva</DialogTitle>
          <DialogDescription>Modifica el título y la descripción de la diapositiva.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 mt-4">
          <Input
            id="slide-title"
            label="Título"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <div className="space-y-1.5">
            <label htmlFor="slide-desc" className="block text-sm font-medium text-foreground">
              Descripción
            </label>
            <Textarea
              id="slide-desc"
              value={editDesc}
              onChange={(e) => setEditDesc(e.target.value)}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={!editTitle.trim()}>
            Guardar
          </Button>
        </DialogFooter>
      </Dialog>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <DialogHeader>
          <DialogTitle>Eliminar diapositiva</DialogTitle>
          <DialogDescription>
            ¿Estás seguro de que quieres eliminar &quot;{title}&quot;? Esta acción no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={deleting}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={handleDelete} loading={deleting}>
            Eliminar
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

export { SlideCard };
export type { SlideCardProps };
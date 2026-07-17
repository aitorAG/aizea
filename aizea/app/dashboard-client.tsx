"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit, BookOpen, Layers, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/components/toast";
import { revalidateDashboard } from "@/lib/actions/revalidate";
import { useCourseAdapter } from "@/lib/adapters/useCourseAdapter";
import type { CourseListItem } from "./page";

interface DashboardClientProps {
  courses: CourseListItem[];
  updateCourseName: (id: string, name: string) => Promise<void>;
}

function DashboardClient({ courses, updateCourseName }: DashboardClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const courseAdapter = useCourseAdapter();

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit dialog state
  const [editTarget, setEditTarget] = useState<CourseListItem | null>(null);
  const [editName, setEditName] = useState("");
  const [editing, setEditing] = useState(false);

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<CourseListItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const course = await courseAdapter.createCourse(newName.trim());
      // Close the dialog and navigate *before* showing the toast.
      // Reasons:
      // 1. The toast helper used to throw `crypto.randomUUID is not a
      //    function` on non-secure contexts (e.g. when accessing the
      //    app via a LAN IP). That throw used to skip the
      //    `setCreateOpen(false)` below, leaving the dialog stuck open.
      // 2. Even with the toast bug fixed, we want a hard guarantee that
      //    a successful create always closes the dialog — the toast is
      //    a nice-to-have, not a precondition.
      setCreateOpen(false);
      setNewName("");
      router.push(`/courses/${course.id}/materials`);
      toast({
        title: "Curso creado",
        description: `"${newName.trim()}" se ha creado correctamente.`,
        variant: "success",
      });
    } catch (err) {
      // On error we also close the dialog so the user is never trapped
      // in it (e.g. by a transient network failure). The error is
      // surfaced via a toast on the dashboard behind the dialog.
      setCreateOpen(false);
      setNewName("");
      toast({
        title: "Error al crear",
        description: err instanceof Error ? err.message : "No se pudo crear el curso.",
        variant: "error",
      });
    } finally {
      setCreating(false);
    }
  }, [newName, toast, router, courseAdapter]);

  const handleEdit = useCallback(async () => {
    if (!editTarget || !editName.trim()) return;
    setEditing(true);
    try {
      await updateCourseName(editTarget.id, editName.trim());
      toast({
        title: "Curso renombrado",
        description: `El curso ahora se llama "${editName.trim()}".`,
        variant: "success",
      });
      setEditTarget(null);
      setEditName("");
      await revalidateDashboard();
    } catch (err) {
      toast({
        title: "Error al renombrar",
        description: err instanceof Error ? err.message : "No se pudo renombrar el curso.",
        variant: "error",
      });
    } finally {
      setEditing(false);
    }
  }, [editTarget, editName, toast, updateCourseName]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await courseAdapter.deleteCourse(deleteTarget.id);
      toast({
        title: "Curso eliminado",
        description: `"${deleteTarget.name}" se ha eliminado.`,
        variant: "success",
      });
      setDeleteTarget(null);
      await revalidateDashboard();
    } catch (err) {
      toast({
        title: "Error al eliminar",
        description: err instanceof Error ? err.message : "No se pudo eliminar el curso.",
        variant: "error",
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, toast, courseAdapter]);

  function openEdit(course: CourseListItem) {
    setEditTarget(course);
    setEditName(course.name);
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  return (
    <>
      {/* Action bar */}
      <div className="flex items-center justify-end">
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Nuevo Curso
        </Button>
      </div>

      {/* Course list */}
      {courses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-8 w-8" />}
          title="Sin cursos aún"
          description="Crea tu primer curso para comenzar a generar materiales con IA."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              Crear curso
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {courses.map((course) => (
            <Card
              key={course.id}
              className="group transition-shadow hover:shadow-md"
            >
              <div className="flex items-center gap-4 p-4">
                {/* Clickable name + badges */}
                <Link
                  href={`/courses/${course.id}/materials`}
                  className="flex flex-1 items-center gap-4 min-w-0"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BookOpen className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-semibold text-foreground truncate group-hover:text-primary transition-colors">
                      {course.name}
                    </h3>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="secondary" className="gap-1">
                        <Layers className="h-3 w-3" />
                        {course.slideCount} diapositivas
                      </Badge>
                      <Badge variant="outline" className="gap-1">
                        <FileText className="h-3 w-3" />
                        {course.materialCount} materiales
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Actualizado el {formatDate(course.updatedAt)}
                      </span>
                    </div>
                  </div>
                </Link>

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(course)}
                  >
                    <Edit className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Editar</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(course)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create Course Dialog */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)}>
        <DialogHeader>
          <DialogTitle>Nuevo Curso</DialogTitle>
          <DialogDescription>
            Introduce un nombre para tu nuevo curso. Podrás añadir materiales y
            generar diapositivas después.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Input
            id="new-course-name"
            label="Nombre del curso"
            placeholder="Ej: Matemáticas Discretas — Unidad 3"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={creating}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setCreateOpen(false);
              setNewName("");
            }}
            disabled={creating}
          >
            Cancelar
          </Button>
          <Button onClick={handleCreate} loading={creating} disabled={!newName.trim()}>
            Crear Curso
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Edit Course Dialog */}
      <Dialog
        open={editTarget !== null}
        onClose={() => {
          if (!editing) setEditTarget(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>Renombrar curso</DialogTitle>
          <DialogDescription>
            Cambia el nombre del curso &quot;{editTarget?.name}&quot;.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Input
            id="edit-course-name"
            label="Nuevo nombre"
            placeholder="Nombre del curso"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            disabled={editing}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setEditTarget(null)}
            disabled={editing}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleEdit}
            loading={editing}
            disabled={!editName.trim() || editName.trim() === editTarget?.name}
          >
            Guardar
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
      >
        <DialogHeader>
          <DialogTitle>Eliminar curso</DialogTitle>
          <DialogDescription>
            ¿Estás seguro de que quieres eliminar &quot;{deleteTarget?.name}&quot;?
            Se borrarán todos sus materiales, diapositivas y figuras. Esta acción
            no se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            loading={deleting}
          >
            Eliminar
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

export { DashboardClient };
export type { DashboardClientProps };
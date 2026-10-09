"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Edit, BookOpen, Layers, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import { CourseStatusIcons } from "@/components/course/CourseStatusIcons";
import { useLocale, useTranslations } from "@/components/LocaleProvider";
import type { CourseListItem } from "./page";

interface DashboardClientProps {
  courses: CourseListItem[];
  updateCourseName: (id: string, name: string) => Promise<void>;
}

function DashboardClient({ courses, updateCourseName }: DashboardClientProps) {
  const router = useRouter();
  const { toast } = useToast();
  const courseAdapter = useCourseAdapter();
  const locale = useLocale();
  const t = useTranslations();

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newLlmContext, setNewLlmContext] = useState("");
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
      const course = await courseAdapter.createCourse(newName.trim(), newLlmContext.trim() || undefined);
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
      setNewLlmContext("");
      router.refresh(); // v1.8: ensure course list updates when returning
      router.push(`/courses/${course.id}/materials`);
      toast({
        title: t("courseCreated"),
        description: t("courseCreatedDescription", { name: newName.trim() }),
        variant: "success",
      });
    } catch (err) {
      console.error("[dashboard] course creation failed:", err);
      // On error we also close the dialog so the user is never trapped
      // in it (e.g. by a transient network failure). The error is
      // surfaced via a toast on the dashboard behind the dialog.
      setCreateOpen(false);
      setNewName("");
      setNewLlmContext("");
      toast({
        title: t("createCourseError"),
        description: t("createCourseFailed"),
        variant: "error",
      });
    } finally {
      setCreating(false);
    }
  }, [newName, newLlmContext, toast, router, courseAdapter, t]);

  const handleEdit = useCallback(async () => {
    if (!editTarget || !editName.trim()) return;
    setEditing(true);
    try {
      await updateCourseName(editTarget.id, editName.trim());
      toast({
        title: t("courseRenamed"),
        description: t("courseRenamedDescription", { name: editName.trim() }),
        variant: "success",
      });
      setEditTarget(null);
      setEditName("");
      await revalidateDashboard();
    } catch (err) {
      console.error("[dashboard] course rename failed:", err);
      toast({
        title: t("renameCourseError"),
        description: t("renameCourseFailed"),
        variant: "error",
      });
    } finally {
      setEditing(false);
    }
  }, [editTarget, editName, toast, updateCourseName, t]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await courseAdapter.deleteCourse(deleteTarget.id);
      toast({
        title: t("courseDeleted"),
        description: t("courseDeletedDescription", { name: deleteTarget.name }),
        variant: "success",
      });
      setDeleteTarget(null);
      await revalidateDashboard();
    } catch (err) {
      console.error("[dashboard] course deletion failed:", err);
      toast({
        title: t("deleteCourseError"),
        description: t("deleteCourseFailed"),
        variant: "error",
      });
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, toast, courseAdapter, t]);

  function openEdit(course: CourseListItem) {
    setEditTarget(course);
    setEditName(course.name);
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
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
          {t("newCourse")}
        </Button>
      </div>

      {/* Course list */}
      {courses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-8 w-8" />}
          title={t("noCourses")}
          description={t("noCoursesDescription")}
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              {t("createCourse")}
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
                        {t(course.slideCount === 1 ? "slideCountOne" : "slidesCount", {
                          count: course.slideCount,
                        })}
                      </Badge>
                      <Badge variant="outline" className="gap-1">
                        <FileText className="h-3 w-3" />
                        {t(course.materialCount === 1 ? "materialCountOne" : "materialsCount", {
                          count: course.materialCount,
                        })}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {t("updatedOn", { date: formatDate(course.updatedAt) })}
                      </span>
                    </div>
                  </div>
                </Link>

                {/* Status icons (tree / slides) — visually separated from
                    the action buttons by a 1px left border + extra
                    padding. The icons are navigational, not mutating. */}
                <CourseStatusIcons
                  courseId={course.id}
                  hasTree={course.hasTree}
                  hasSlides={course.hasSlides}
                />

                {/* Action buttons */}
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(course)}
                  >
                    <Edit className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t("edit")}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteTarget(course)}
                    aria-label={t("deleteCourse")}
                    title={t("deleteCourse")}
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
          <DialogTitle>{t("newCourse")}</DialogTitle>
          <DialogDescription>{t("createCourseDescription")}</DialogDescription>
        </DialogHeader>
        <div className="mt-4 space-y-4">
          <Input
            id="new-course-name"
            label={t("courseName")}
            placeholder={t("courseNameExample")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={creating}
            autoFocus
          />
          <div>
            <label htmlFor="new-course-context" className="block text-sm font-medium mb-1.5">
              {t("courseContextOptional")}
            </label>
            <Textarea
              id="new-course-context"
              placeholder={t("courseContextExample")}
              value={newLlmContext}
              onChange={(e) => setNewLlmContext(e.target.value)}
              disabled={creating}
              rows={4}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              {t("courseContextHint")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setCreateOpen(false);
              setNewName("");
              setNewLlmContext("");
            }}
            disabled={creating}
          >
            {t("cancel")}
          </Button>
          <Button onClick={handleCreate} loading={creating} disabled={!newName.trim()}>
            {t("create")}
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
          <DialogTitle>{t("renameCourse")}</DialogTitle>
          <DialogDescription>
            {t("renameCourseDescription", { name: editTarget?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4">
          <Input
            id="edit-course-name"
            label={t("newName")}
            placeholder={t("courseName")}
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
            {t("cancel")}
          </Button>
          <Button
            onClick={handleEdit}
            loading={editing}
            disabled={!editName.trim() || editName.trim() === editTarget?.name}
          >
            {t("save")}
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
          <DialogTitle>{t("deleteCourse")}</DialogTitle>
          <DialogDescription>
            {t("deleteCourseDescription", { name: deleteTarget?.name ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setDeleteTarget(null)}
            disabled={deleting}
          >
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            loading={deleting}
          >
            {t("delete")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

export { DashboardClient };
export type { DashboardClientProps };

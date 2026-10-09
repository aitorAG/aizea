"use client";

import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, FileText, Layers } from "lucide-react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useState } from "react";
import { revalidateDashboard } from "@/lib/actions/revalidate";
import { useCourseAdapter } from "@/lib/adapters/useCourseAdapter";
import { useLocale, useTranslations } from "@/components/LocaleProvider";

interface CourseCardProps {
  id: string;
  name: string;
  slideCount: number;
  materialCount: number;
  updatedAt: string;
}

function CourseCard({ id, name, slideCount, materialCount, updatedAt }: CourseCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const courseAdapter = useCourseAdapter();
  const t = useTranslations();
  const locale = useLocale();

  async function handleDelete() {
    setDeleting(true);
    try {
      await courseAdapter.deleteCourse(id);
      await revalidateDashboard();
    } catch {
      setDeleting(false);
    }
  }

  const dateStr = new Date(updatedAt).toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <Card className="group transition-shadow hover:shadow-md">
        <Link href={`/courses/${id}`}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base line-clamp-1">{name}</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <Layers className="h-3 w-3" />
                {t(slideCount === 1 ? "slideCountOne" : "slidesCount", { count: slideCount })}
              </Badge>
              <Badge variant="outline" className="gap-1">
                <FileText className="h-3 w-3" />
                {t(materialCount === 1 ? "materialCountOne" : "materialsCount", { count: materialCount })}
              </Badge>
            </div>
          </CardContent>
        </Link>
        <CardFooter className="flex items-center justify-between pt-0">
          <span className="text-xs text-muted-foreground">{t("updatedOn", { date: dateStr })}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setConfirmOpen(true);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span className="sr-only">{t("delete")}</span>
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogHeader>
          <DialogTitle>{t("deleteCourse")}</DialogTitle>
          <DialogDescription>
            {t("deleteCourseDescription", { name })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
            {t("cancel")}
          </Button>
          <Button variant="destructive" onClick={handleDelete} loading={deleting}>
            {t("delete")}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}

export { CourseCard };
export type { CourseCardProps };

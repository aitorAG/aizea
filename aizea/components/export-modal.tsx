"use client";

import { useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2, FileText } from "lucide-react";
import { isTauri } from "@/lib/client/tauri";
import { useToast } from "@/components/toast";
import { useTranslations } from "@/components/LocaleProvider";

const DOWNLOAD_CLEANUP_DELAY_MS = 1000;

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  courseId: string;
}

function ExportModal({ open, onClose, courseId }: ExportModalProps) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const t = useTranslations();

  function exportError(message: string | undefined, status?: number): string {
    if (message === "Falta courseId") return t("export.missingCourseId");
    if (message === "Curso no encontrado") return t("export.courseNotFound");
    if (message === "Error interno") return t("export.internalError");
    if (status !== undefined) return t("export.httpError", { status });
    return message ?? t("export.failedMaterial");
  }

  async function handleExport() {
    setExporting(true);
    setError(null);
    try {
      const response = await fetch(`/api/export?courseId=${courseId}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(exportError(payload?.error, response.status));
      }

      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { invoke } = await import("@tauri-apps/api/core");
        const data = await response.text();
        const path = await save({
          filters: [{ name: "HTML", extensions: ["html"] }],
          defaultPath: "material-docente.html",
        });
        if (path) {
          await invoke("save_file", { path, data });
          toast({ title: t("export.ready"), description: t("export.savedMaterial") });
        }
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "material-docente.html";
        document.body.appendChild(anchor);
        try {
          anchor.click();
          window.setTimeout(() => {
            anchor.remove();
            URL.revokeObjectURL(url);
          }, DOWNLOAD_CLEANUP_DELAY_MS);
        } catch (err) {
          anchor.remove();
          URL.revokeObjectURL(url);
          throw err;
        }
        toast({ title: t("export.ready"), description: t("export.downloadedMaterial") });
      }
    } catch (err) {
      console.error("[export] material export failed:", err);
      const message = err instanceof Error ? exportError(err.message) : t("export.failedMaterial");
      setError(message);
      toast({ title: t("export.failed"), description: message, variant: "error" });
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>{t("export.materialTitle")}</DialogTitle>
        <DialogDescription>
          {t("export.materialDescription")}
        </DialogDescription>
      </DialogHeader>
      {error && (
        <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      )}
      <div className="mt-4">
        <Button
          className="w-full justify-start gap-3 h-auto py-4"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <FileText className="h-5 w-5" />
          )}
          <div className="text-left">
            <div className="font-medium">{t("export.material")}</div>
            <div className="text-xs text-muted-foreground font-normal">
              {t("export.materialFormat")}
            </div>
          </div>
          <FileDown className="h-4 w-4 ml-auto text-muted-foreground" />
        </Button>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={exporting}>
          {t("common.cancel")}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export { ExportModal };
export type { ExportModalProps };

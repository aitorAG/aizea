"use client";

import { useState } from "react";
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileDown, Loader2, FileText } from "lucide-react";

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  courseId: string;
}

function isTauri() {
  return typeof window !== "undefined" && !!(window as any).__TAURI__;
}

function ExportModal({ open, onClose, courseId }: ExportModalProps) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      if (isTauri()) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        const { invoke } = await import("@tauri-apps/api/core");
        const response = await fetch(`/api/export?courseId=${courseId}`);
        const data = await response.text();
        const path = await save({
          filters: [{ name: "HTML", extensions: ["html"] }],
          defaultPath: "material-docente.html",
        });
        if (path) {
          await invoke("save_file", { path, data });
        }
      } else {
        window.open(`/api/export?courseId=${courseId}`, "_blank");
      }
    } finally {
      setExporting(false);
      onClose();
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Exportar material docente</DialogTitle>
        <DialogDescription>
          Genera un documento HTML listo para imprimir (Ctrl+P → PDF). Una página por
          diapositiva con el diseño, guion, relevancia y narrativa.
        </DialogDescription>
      </DialogHeader>
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
            <div className="font-medium">Material Docente</div>
            <div className="text-xs text-muted-foreground font-normal">
              HTML imprimible — diseño + guion + relevancia + narrativa por diapositiva
            </div>
          </div>
          <FileDown className="h-4 w-4 ml-auto text-muted-foreground" />
        </Button>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={exporting}>
          Cancelar
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export { ExportModal };
export type { ExportModalProps };

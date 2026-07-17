"use client";

import { useState, useCallback, useRef } from "react";
import { useMaterialAdapter } from "@/lib/adapters/useMaterialAdapter";
import { useToast } from "@/components/toast";
import { Upload, FileText, Loader2 } from "lucide-react";

interface UploadZoneProps {
  courseId: string;
  onUploadComplete: () => void;
}

function isTauri() {
  return typeof window !== "undefined" && !!(window as any).__TAURI__;
}

function UploadZone({ courseId, onUploadComplete }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const materialAdapter = useMaterialAdapter(courseId);

  const uploadFile = useCallback(
    async (file: File) => {
      try {
        const formData = new FormData();
        formData.append("file", file);
        await materialAdapter.uploadMaterial(formData);
        toast({
          title: "Archivo subido",
          description: `"${file.name}" se ha subido correctamente.`,
          variant: "success",
        });
      } catch (err) {
        toast({
          title: "Error al subir",
          description: `No se pudo subir "${file.name}": ${err instanceof Error ? err.message : "Error desconocido"}`,
          variant: "error",
        });
      }
    },
    [toast, materialAdapter]
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const pdfFiles = Array.from(files).filter(
        (f) => f.type === "application/pdf" || f.name.endsWith(".pdf")
      );

      if (pdfFiles.length === 0) {
        toast({ title: "Formato no válido", description: "Solo se aceptan archivos PDF.", variant: "error" });
        return;
      }

      setUploading(true);

      for (const file of pdfFiles) {
        await uploadFile(file);
      }

      setUploading(false);
      onUploadComplete();
    },
    [onUploadComplete, toast, uploadFile]
  );

  async function handleTauriOpen() {
    if (uploading) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const selected = await open({
        multiple: true,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      setUploading(true);
      for (const path of paths) {
        const bytes = await readFile(path);
        const name = path.split(/[/\\]/).pop() || "archivo.pdf";
        const file = new File([bytes], name, { type: "application/pdf" });
        await uploadFile(file);
      }
      setUploading(false);
      onUploadComplete();
    } catch (err) {
      setUploading(false);
      toast({
        title: "Error al abrir archivo",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "error",
      });
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setDragging(true);
  }

  function handleDragLeave() {
    setDragging(false);
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  }

  function handleClick() {
    if (isTauri()) {
      handleTauriOpen();
    } else if (inputRef.current) {
      inputRef.current.click();
    }
  }

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={handleClick}
      className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors cursor-pointer ${
        dragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30"
      } ${uploading ? "pointer-events-none opacity-60" : ""}`}
    >
      {uploading ? (
        <>
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-3 text-sm font-medium text-foreground">Subiendo archivo...</p>
          <p className="mt-1 text-xs text-muted-foreground">Por favor, espera</p>
        </>
      ) : (
        <>
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Upload className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-medium text-foreground">
            Arrastra archivos PDF aquí
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            o haz clic para seleccionar archivos
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            Solo archivos PDF
          </div>
        </>
      )}
      {!isTauri() && (
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          onChange={handleInputChange}
          className="absolute inset-0 cursor-pointer opacity-0"
          disabled={uploading}
        />
      )}
    </div>
  );
}

export { UploadZone };
export type { UploadZoneProps };

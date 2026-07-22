"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  FileText,
  Save,
  Loader2,
  BookOpen,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { MaterialFileCard } from "@/components/material-file-card";
import { useToast } from "@/components/toast";
import { updateCourseContext } from "@/lib/actions/course";
import { revalidateMaterials } from "@/lib/actions/revalidate";
import { useMaterialAdapter } from "@/lib/adapters/useMaterialAdapter";
import { cn } from "@/lib/utils";
import type { MaterialItem } from "./page";

interface MaterialsClientProps {
  courseId: string;
  courseName: string;
  llmContext: string;
  materials: MaterialItem[];
}

const ACCEPTED_TYPES = ".pdf,.doc,.docx,.odt,.rtf,.png,.jpg,.jpeg,.gif,.webp,.bmp,.svg";
const ACCEPTED_MIME =
  "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*";

function MaterialsClient({
  courseId,
  courseName,
  llmContext: initialContext,
  materials: initialMaterials,
}: MaterialsClientProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [materials, setMaterials] = useState<MaterialItem[]>(initialMaterials);
  const [context, setContext] = useState(initialContext);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingFileName, setUploadingFileName] = useState<string | null>(null);
  // Real byte-level upload progress, 0..100. Reset to 0 at the
  // start of each file so the bar starts from the left and grows
  // as `xhr.upload.onprogress` fires. Replaces the previous
  // indeterminate CSS animation (issue v1.5 finding 1.1 — the
  // bar only had two visual states: 50% from the start and
  // 100% at the end).
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const materialAdapter = useMaterialAdapter(courseId);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;

      const validFiles = Array.from(files).filter((f) => {
        const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
        return (
          f.type === "application/pdf" ||
          f.type.startsWith("image/") ||
          f.type.includes("word") ||
          ["pdf", "doc", "docx", "odt", "rtf", "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext)
        );
      });

      if (validFiles.length === 0) {
        toast({
          title: "Formato no válido",
          description: "Solo se aceptan PDFs, documentos Word e imágenes.",
          variant: "error",
        });
        return;
      }

      setUploading(true);

      // v1.8.1 / Issue 2 — wrap the whole batch in try/finally so
      // `setUploading(false)` runs on EVERY exit path (success,
      // error inside the per-file try/catch, revalidation throw,
      // router.refresh throw). The previous version reset
      // uploading after the loop but the optimistic
      // `setMaterials` + `toast` + `revalidateMaterials` +
      // `router.refresh` chain could throw and leave the spinner
      // stuck. The per-file try/catch still shields the loop from
      // individual file failures.
      try {
        for (const file of validFiles) {
          setUploadingFileName(file.name);
          // Reset the bar so the next file starts at 0%, not at
          // whatever the previous file ended at.
          setUploadProgress(0);
          try {
            const formData = new FormData();
            formData.append("file", file);
            const result = await materialAdapter.uploadMaterial(formData, {
              onProgress: setUploadProgress,
            });
            // ROOT-CAUSE FIX for "Materials uploaded don't appear in the
            // list": the server returns the new material, but the local
            // `materials` state is initialized from `initialMaterials` and
            // is never updated. We optimistically append the new row
            // BEFORE the server revalidation completes so the user sees
            // their file appear immediately — and we also call
            // router.refresh() to pull the canonical row (with real
            // createdAt, pageCount, etc.) from the DB.
            const newMaterial: MaterialItem = {
              id: result.id,
              filename: result.filename ?? file.name,
              fileSize: file.size,
              fileType: file.type || file.name.split(".").pop()?.toLowerCase() || null,
              pageCount: 0,
              createdAt: new Date().toISOString(),
            };
            setMaterials((prev) => [
              newMaterial,
              ...prev.filter((m) => m.id !== result.id),
            ]);
            toast({
              title: "Archivo subido",
              // v1.5 finding 1.7: upload ONLY persists the file.
              // The pipeline (segmentation, extraction, tree
              // building) is gated behind the explicit
              // "Generar árbol" CTA. Telling the user that
              // processing has started here is misleading — the
              // upload is now < 2s and no jobs are created.
              description: `"${file.name}" se ha subido correctamente. Ve a "Generar árbol" para procesarlo.`,
              variant: "success",
            });
          } catch (err) {
            toast({
              title: "Error al subir",
              description: `No se pudo subir "${file.name}": ${err instanceof Error ? err.message : "Error desconocido"}`,
              variant: "error",
            });
          }
        }
      } finally {
        // v1.8.1 / Issue 2 — ALWAYS clear the uploading state on
        // exit. The spinner is the only signal the user has that
        // their file is being processed; if we forget to clear it
        // the upload UI appears hung forever.
        setUploadingFileName(null);
        setUploadProgress(0);
        setUploading(false);
      }

      // `revalidateMaterials` + `router.refresh` are best-effort —
      // the upload itself has already committed, so a failure here
      // should NOT block the spinner from clearing (handled above)
      // nor surface as a scary error. The user will see the file
      // in the optimistic list; the next navigation will pull the
      // canonical row.
      try {
        await revalidateMaterials(courseId);
        // Force the server component to re-render so we get the
        // canonical rows (pageCount, createdAt, etc.) — the optimistic
        // append above gave us instant feedback; this refresh gives us
        // truth.
        router.refresh();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[materials] post-upload revalidation failed:",
          err instanceof Error ? err.message : err
        );
      }
    },
    [courseId, toast, materialAdapter, router]
  );

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

  const handleDelete = useCallback(
    async (materialId: string) => {
      setDeletingId(materialId);
      try {
        await materialAdapter.deleteMaterial(materialId);
        setMaterials((prev) => prev.filter((m) => m.id !== materialId));
        toast({
          title: "Material eliminado",
          variant: "success",
        });
        await revalidateMaterials(courseId);
      } catch (err) {
        toast({
          title: "Error al eliminar",
          description: err instanceof Error ? err.message : "No se pudo eliminar el material.",
          variant: "error",
        });
      } finally {
        setDeletingId(null);
      }
    },
    [toast, courseId, materialAdapter]
  );

  const handlePreview = useCallback((filename: string) => {
    // encodeURIComponent handles spaces, accents, and other characters
    // that would otherwise truncate the URL or 404 the request.
    window.open(`/uploads/${encodeURIComponent(filename)}`, "_blank");
  }, []);

  const handleSaveAndContinue = useCallback(async () => {
    setSaving(true);
    try {
      await updateCourseContext(courseId, context);
      toast({
        title: "Contexto guardado",
        // F3: the next phase is the conceptual tree (phase 2), NOT
        // the slides (phase 3). The user must land on /tree to either
        // see the existing tree or the empty-state CTA "Generar árbol".
        description: "Continuando al árbol conceptual...",
        variant: "success",
      });
      router.push(`/courses/${courseId}/tree`);
    } catch (err) {
      toast({
        title: "Error al guardar",
        description: err instanceof Error ? err.message : "No se pudo guardar el contexto.",
        variant: "error",
      });
      setSaving(false);
    }
  }, [courseId, context, toast, router]);

  return (
    <div className="space-y-8">
      {/* Breadcrumb header */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          AIzea
          <span className="text-muted-foreground/50">/</span>
          <span className="text-foreground font-medium">{courseName}</span>
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Materiales del Curso
        </h1>
      </div>

      {/* Materials Section */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Materiales</h2>
        </div>

        {/* Upload zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          data-testid="upload-zone"
          className={cn(
            "relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            dragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/30",
            uploading && "pointer-events-none opacity-60"
          )}
        >
          {uploading ? (
            <>
              <Loader2
                className="h-8 w-8 animate-spin text-primary"
                data-testid="upload-spinner"
                aria-label="Subiendo archivo"
              />
              <p className="mt-3 text-sm font-medium text-foreground">
                Subiendo archivo...
              </p>
              <p
                className="mt-1 max-w-[28ch] truncate text-xs text-muted-foreground"
                data-testid="upload-filename"
                title={uploadingFileName ?? undefined}
              >
                {uploadingFileName ?? "Por favor, espera"}
              </p>
              {/* Real percent-based progress bar. `uploadProgress`
                  is driven by `xhr.upload.onprogress` in the
                  adapter, so it grows from 0% to 100% as the
                  request body streams. This replaces the previous
                  indeterminate CSS animation that only had two
                  visual states (issue v1.5 finding 1.1). */}
              <div
                className="mt-3 h-1.5 w-40 overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-label="Progreso de subida"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={uploadProgress}
                data-testid="upload-progress-bar"
              >
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-150 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                  data-testid="upload-progress-fill"
                />
              </div>
              <p
                className="mt-1 text-xs tabular-nums text-muted-foreground"
                data-testid="upload-progress-text"
              >
                {uploadProgress}%
              </p>
            </>
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Upload className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">
                Arrastra archivos aquí
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                o haz clic para seleccionar archivos
              </p>
              <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <FileText className="h-3.5 w-3.5" />
                PDFs, documentos Word e imágenes
              </div>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_MIME}
            multiple
            onChange={handleInputChange}
            className="absolute inset-0 cursor-pointer opacity-0"
            disabled={uploading}
          />
        </div>

        {/* File list */}
        {materials.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="Sin materiales subidos"
            description="Sube archivos PDF, documentos Word o imágenes para que la IA los procese."
          />
        ) : (
          <div className="space-y-2">
            {materials.map((material) => (
              <MaterialFileCard
                key={material.id}
                filename={material.filename}
                fileSize={material.fileSize}
                fileType={material.fileType}
                onDelete={() => handleDelete(material.id)}
                onPreview={() => handlePreview(material.filename)}
                deleting={deletingId === material.id}
              />
            ))}
          </div>
        )}
      </section>

      {/* Context Section */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Contexto para la IA</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Instrucciones adicionales para guiar a la IA en la generación de contenido.
        </p>
        <Textarea
          id="llm-context"
          label="Instrucciones para la IA"
          placeholder="Ej: El curso está dirigido a estudiantes de primer año de ingeniería. Usa un tono didáctico y ejemplos prácticos. Incluye referencias a la bibliografía del PDF principal..."
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={6}
          className="min-h-[140px]"
        />
      </section>

      {/* Bottom actions */}
      <div className="space-y-3 border-t border-border pt-6">
        {/* F3: explicit hint so the user knows what "continuar" means —
            the next phase is the conceptual tree, not the slides. */}
        <p
          id="save-and-continue-hint"
          className="text-xs text-muted-foreground"
        >
          Al guardar, continuarás a la <strong>fase 2: árbol conceptual</strong>.
          Si ya existe un árbol, lo verás. Si no, podrás generarlo.
        </p>
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
          <Button
            onClick={handleSaveAndContinue}
            loading={saving}
            data-testid="save-and-continue"
          >
            <Save className="h-4 w-4" />
            Guardar y continuar
          </Button>
        </div>
      </div>
    </div>
  );
}

export { MaterialsClient };
export type { MaterialsClientProps };
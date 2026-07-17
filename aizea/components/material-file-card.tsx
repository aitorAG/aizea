"use client";

import { FileText, FileImage, File, Eye, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface MaterialFileCardProps {
  filename: string;
  fileSize: number | null;
  fileType: string | null;
  onDelete: () => void;
  onPreview: () => void;
  deleting?: boolean;
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes === 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(fileType: string | null, filename: string): React.ReactNode {
  const type = fileType?.toLowerCase() ?? "";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";

  if (
    type === "application/pdf" ||
    ext === "pdf"
  ) {
    return <FileText className="h-5 w-5 text-red-500 shrink-0" />;
  }

  if (
    type.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"].includes(ext)
  ) {
    return <FileImage className="h-5 w-5 text-blue-500 shrink-0" />;
  }

  if (
    type.includes("word") ||
    type.includes("document") ||
    ["doc", "docx", "odt", "rtf"].includes(ext)
  ) {
    return <File className="h-5 w-5 text-indigo-500 shrink-0" />;
  }

  return <File className="h-5 w-5 text-muted-foreground shrink-0" />;
}

function MaterialFileCard({
  filename,
  fileSize,
  fileType,
  onDelete,
  onPreview,
  deleting = false,
}: MaterialFileCardProps) {
  // Strip the timestamp prefix for display (format: "1234567890_originalname.pdf")
  const displayName = filename.replace(/^\d+_/, "");

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors",
        deleting && "opacity-60"
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {getFileIcon(fileType, filename)}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate" title={displayName}>
            {displayName}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(fileSize)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={onPreview}
          disabled={deleting}
          className="h-8 text-muted-foreground hover:text-foreground"
        >
          <Eye className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Previsualizar</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={deleting}
          className="h-8 text-muted-foreground hover:text-destructive"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export { MaterialFileCard, formatFileSize };
export type { MaterialFileCardProps };
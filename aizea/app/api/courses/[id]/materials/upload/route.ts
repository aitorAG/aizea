// Material upload route handler.
//
// The server action in `lib/actions/material.ts` is the canonical
// path for material uploads, but Next.js server actions do NOT
// expose upload progress events to the client. To power a real
// percent-based progress bar (issue v1.5 finding 1.1 — "the upload
// bar only shows two dots: 50% from the start and 100% on finish"),
// we expose the same use case behind a regular HTTP route the
// client can call with XMLHttpRequest and listen to
// `xhr.upload.onprogress` for byte-level progress.
//
// This route delegates to the same `UploadMaterialUseCase` the
// server action uses, so behavior is identical — only the wire
// format changes (JSON + FormData via fetch/XHR instead of
// Next.js' RPC protocol).

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { container } from "@/lib/composition/container";

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "odt",
  "rtf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
]);
const ALLOWED_MIME = new Set([
  "",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

// Node runtime: we read the FormData via standard Web APIs and
// `arrayBuffer()` to get a Buffer for the use case.
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: courseId } = await params;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Cuerpo de la solicitud inválido" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "No se proporcionó ningún archivo" },
      { status: 400 }
    );
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = file.type.startsWith("image/") && extension !== "";
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large" }, { status: 413 });
  }
  if (
    !/^[a-z0-9]{1,5}$/.test(extension) ||
    !ALLOWED_EXTENSIONS.has(extension)
  ) {
    return NextResponse.json(
      { error: "Unsupported file extension" },
      { status: 400 }
    );
  }
  if (!ALLOWED_MIME.has(file.type.toLowerCase()) && !isImage) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  // Keep user-controlled names out of storage paths while preserving the
  // extension needed by downstream material processing.
  const filename = `${Date.now()}_${crypto.randomUUID()}.${extension}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const { material } = await container.uploadMaterial.execute({
      courseId,
      filename,
      fileType:
        file.type || file.name.split(".").pop()?.toLowerCase() || null,
      fileSize: file.size,
      buffer,
      userId: "default",
    });

    // Mirror the revalidation the server action performs so any
    // caller that bypasses the action (e.g. a direct curl) still
    // triggers page refreshes.
    revalidatePath(`/courses/${courseId}/materials`);
    revalidatePath(`/courses/${courseId}/tree`);
    revalidatePath(`/courses/${courseId}`);

    return NextResponse.json({
      id: material.id,
      filename: material.filename,
      content: material.content,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error al subir";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

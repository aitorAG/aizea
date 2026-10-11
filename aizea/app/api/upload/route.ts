// POST /api/upload — subida directa de fichero vía REST.
//
// v0.14.0 — hardening:
//   - Extensión whitelist estricta (solo PDF) y sanitizada: el valor NUNCA
//     se interpola sin validar, evitando path traversal vía `file.name`
//     (p. ej. "x.pdf/../../evil" producía un ext con slashes).
//   - Límite de tamaño (100 MB) → 413.
//   - MIME permitido: application/pdf, vacío u octet-stream (los webviews
//     a veces envían genérico); cualquier otro → 400.
//
// NOTA: el flujo principal de subida es el server action `uploadMaterial`
// (lib/actions/material.ts), que además extrae texto e indexa RAG. Esta ruta
// existe para clientes que no pueden usar server actions.

import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import { getUploadsDir } from "@/lib/paths";

/** Tamaño máximo de subida: 100 MB. */
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

/** Extensiones permitidas (tras lowercase). */
const ALLOWED_EXTENSIONS = new Set(["pdf"]);

/** MIME types aceptados; vacío/octet-stream se toleran por compatibilidad. */
const ALLOWED_MIME = new Set(["application/pdf", "", "application/octet-stream"]);

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const entry = formData.get("file");
    if (!(entry instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    const file = entry;

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "File too large (max 100MB)" },
        { status: 413 }
      );
    }

    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_MIME.has(mime)) {
      return NextResponse.json(
        { error: "Unsupported file type (only PDF is accepted)" },
        { status: 400 }
      );
    }

    // Extensión estricta: una única parte final alfanumérica de ≤5 chars.
    // Rechaza slashes, puntos múltiples finales y cualquier carácter raro,
    // lo que cierra el path traversal vía el nombre del fichero.
    const rawExt = (file.name.split(".").pop() || "").toLowerCase();
    if (!/^[a-z0-9]{1,5}$/.test(rawExt) || !ALLOWED_EXTENSIONS.has(rawExt)) {
      return NextResponse.json(
        { error: "Unsupported file extension (only .pdf is accepted)" },
        { status: 400 }
      );
    }

    const uploadsDir = getUploadsDir();
    await mkdir(uploadsDir, { recursive: true });

    const filename = `${uuidv4()}.${rawExt}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(join(uploadsDir, filename), buffer);

    return NextResponse.json({ success: true, filename, size: buffer.length });
  } catch {
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

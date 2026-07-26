// Puerto del backend de extracción de PDF.
//
// `PDFService` (dominio) selecciona en runtime entre dos backends:
//   - `PDFServiceJS` (pdf-parse + pdf-lib) — server/web, vive en el dominio.
//   - backend Tauri (IPC `extract_pdf` vía `@tauri-apps/api/core`) — desktop.
// El backend Tauri es un adaptador de infraestructura puro; la Fase 1
// (purificación del dominio) lo mueve a
// `lib/infrastructure/pdf/pdf-service-tauri.ts` y deja aquí el contrato, para
// que `PDFService` NO importe `@tauri-apps` (gate: cero imports de infra en
// domain/).

import type { PDFExtractResult, PDFImage } from "@/lib/domain/pdf/PDFService";

export interface IPdfBackend {
  extractText(buffer: Buffer): Promise<PDFExtractResult>;
  extractImages(buffer: Buffer): Promise<PDFImage[]>;
  extractAll(buffer: Buffer): Promise<PDFExtractResult>;
  extractFigures(
    buffer: Buffer
  ): Promise<Array<{ caption: string; pageNum: number | null }>>;
}

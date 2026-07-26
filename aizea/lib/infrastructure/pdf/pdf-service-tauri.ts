// PdfServiceTauri — implementación de `IPdfBackend` sobre el IPC de Tauri
// (`@tauri-apps/api/core`, comando `extract_pdf`).
//
// Antes vivía en `lib/domain/pdf/PDFServiceTauri.ts`. La Fase 1 (purificación
// del dominio) lo movió a infraestructura: es un adaptador puro sobre el IPC de
// Tauri y no tiene lógica de dominio. El contrato lo expone `IPdfBackend`.
// `PDFService` (dominio) lo resuelve por import dinámico SOLO en runtime Tauri,
// por lo que el dominio nunca importa `@tauri-apps` estáticamente.

import type { PDFExtractResult, PDFImage } from "@/lib/domain/pdf/PDFService";
import type { IPdfBackend } from "@/lib/application/ports/pdf-backend.port";

export interface TauriPdfData {
  text: string;
  pages: number;
  images: Array<{
    page_num: number;
    caption: string | null;
    filename: string;
    data_base64: string;
  }>;
}

export class PdfServiceTauri implements IPdfBackend {
  private async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  async extractText(buffer: Buffer): Promise<PDFExtractResult> {
    const base64 = buffer.toString("base64");
    const result = await this.invoke<TauriPdfData>("extract_pdf", {
      data: base64,
    });

    return {
      text: result.text,
      pages: result.pages,
      metadata: {},
    };
  }

  async extractImages(buffer: Buffer): Promise<PDFImage[]> {
    const base64 = buffer.toString("base64");
    const result = await this.invoke<TauriPdfData>("extract_pdf", {
      data: base64,
    });

    return result.images.map((img, idx) => ({
      id: `${img.page_num}_${idx}`,
      pageNum: img.page_num,
      data: Buffer.from(img.data_base64, "base64"),
      width: 0,
      height: 0,
      format: "png",
    }));
  }

  async extractAll(buffer: Buffer): Promise<PDFExtractResult> {
    return this.extractText(buffer);
  }

  async extractFigures(
    buffer: Buffer
  ): Promise<Array<{ caption: string; pageNum: number | null }>> {
    const base64 = buffer.toString("base64");
    const result = await this.invoke<TauriPdfData>("extract_pdf", {
      data: base64,
    });

    return result.images
      .filter((img) => img.caption)
      .map((img) => ({
        caption: img.caption!,
        pageNum: img.page_num,
      }));
  }
}

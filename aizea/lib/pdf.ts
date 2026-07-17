// @deprecated Use lib/domain/pdf/PDFService.ts instead
import pdfParse from "pdf-parse";

export interface PDFExtractResult {
  text: string;
  pages: number;
  metadata: Record<string, unknown>;
}

export async function extractPDFText(buffer: Buffer): Promise<PDFExtractResult> {
  const data = await pdfParse(buffer);
  return {
    text: data.text,
    pages: data.numpages,
    metadata: data.metadata ?? {},
  };
}

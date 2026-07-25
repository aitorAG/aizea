/**
 * Extracción de referencias a figuras a partir de texto plano.
 *
 * Fuente ÚNICA de verdad del patrón de figuras del dominio. Antes vivía
 * duplicada en `lib/figures.ts` (función libre) y en
 * `PDFServiceJS.extractFigures` (mismo regex copiado). Ambos consumidores
 * ahora dependen de esta función pura.
 *
 * Es lógica de dominio pura: sin acceso a BD, red ni sistema de ficheros.
 */
export interface FigureReference {
  caption: string;
  pageNum: number | null;
}

// Coincide con "Figura 1.2", "Figura 3", "Figure 2.1", etc., seguido de un
// pie de figura opcional hasta el fin de línea o de frase.
const FIGURE_REGEX = /(?:Figura|Figure)\s+(\d+(?:\.\d+)?)[.:]?\s*([^\n.]*)/gi;

export function extractFigureReferences(text: string): FigureReference[] {
  const results: FigureReference[] = [];
  const seen = new Set<string>();

  // El regex es global (flag `g`) y con estado: se crea uno nuevo por llamada
  // para evitar fugas de `lastIndex` entre invocaciones.
  const regex = new RegExp(FIGURE_REGEX.source, FIGURE_REGEX.flags);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const figureNum = match[1];
    const captionText = match[2].trim();
    const caption = captionText
      ? `Figura ${figureNum}: ${captionText}`
      : `Figura ${figureNum}`;

    if (!seen.has(caption)) {
      seen.add(caption);
      results.push({ caption, pageNum: null });
    }
  }

  return results;
}

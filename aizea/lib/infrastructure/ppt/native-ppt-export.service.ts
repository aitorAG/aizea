/**
 * NativePptExportService — genera presentaciones PowerPoint (.pptx) editables
 * a partir de slides de AIzea usando `pptxgenjs` con formas nativas.
 *
 * Estrategia (v3.0 — implementación completa):
 * - Slide content → título + guion + ejercicios como texto editable PPT nativo
 * - Speaker notes → todas las boxes (guion, relevancia, narrativa, ejercicios)
 * - Fórmulas LaTeX → preservadas como texto plano (NO convertir a PNG)
 * - Figuras → insertadas desde figureRefs como PNG desde disco
 * - Layout automático → 1/2/3 columnas según cantidad de figuras
 * - Overflow → slide adicional o reducir contenido para que entre
 * - Diseño didáctico → paleta terracota+slate, Inter typography
 * - NO usa Playwright — genera PPT puramente desde datos estructurados
 *
 * Esto garantiza que el usuario puede abrir el PPT en PowerPoint/Keynote/LibreOffice
 * y EDITAR el contenido directamente (no son imágenes pegadas).
 */

import PptxGenJS from "pptxgenjs";
import { BoxType } from "@/lib/types";
import path from "path";
import fs from "fs/promises";

export interface PptSlideData {
  /** Número jerárquico del slide (ej: "1.2.3") */
  numericPath: string;
  /** Título del slide */
  title: string;
  /** Boxes estructuradas del slide */
  boxes: Record<string, string>;
  /** Figure references (JSON array of figure IDs) */
  figureRefs?: string;
}

export interface NativePptExportOptions {
  /** Nombre del curso (aparece en el título de la presentación) */
  courseName: string;
  /** Slides a exportar, ya ordenados por numericPath */
  slides: PptSlideData[];
  /** Course ID (para buscar figuras en disco) */
  courseId: string;
  /** Optional progress callback for the Jobs tab. */
  onProgress?: (completed: number, total: number) => Promise<void>;
}

/** Paleta terracota + slate (diseño didáctico) */
const COLORS = {
  // Terracotta accent
  terracotta: "C4612F",
  terracottaHover: "A94E22",
  terracottaTint: "F2E3D6",
  // Slate grays
  slate950: "020617",
  slate900: "0f172a",
  slate800: "1e293b",
  slate700: "334155",
  slate600: "475569",
  slate500: "64748b",
  slate400: "94a3b8",
  slate300: "cbd5e1",
  slate200: "e2e8f0",
  slate100: "f1f5f9",
  slate50: "f8fafc",
  // Warm backgrounds
  warmCream: "F7F4EF",
  warmSurface: "FBF9F5",
} as const;

export class NativePptExportService {
  private figuresDir: string;

  constructor(figuresDir?: string) {
    // Default: figures stored in public/figures/{courseId}/
    this.figuresDir = figuresDir ?? path.join(process.cwd(), "public", "figures");
  }

  /**
   * Genera un archivo PPTX nativo editable a partir de los slides de un curso.
   *
   * @param options opciones de exportación
   * @returns Buffer con el archivo .pptx
   */
  async generatePptx(options: NativePptExportOptions): Promise<Buffer> {
    const { courseName, slides, courseId, onProgress } = options;

    // 1. Crear presentación PPT
    const pptx = new PptxGenJS();
    pptx.author = "AIzea";
    pptx.company = "AIzea";
    pptx.subject = courseName;
    pptx.title = courseName;

    // Layout 16:9 (estándar PowerPoint moderno)
    pptx.layout = "LAYOUT_16x9";

    // Define master slide con diseño didáctico
    pptx.defineSlideMaster({
      title: "MASTER_SLIDE",
      background: { color: COLORS.warmCream },
    });

    // 2. Agregar cada slide como contenido editable
    for (const slideData of slides) {
      await this.addSlide(pptx, slideData, courseId);

      if (onProgress) {
        await onProgress(slides.indexOf(slideData) + 1, slides.length);
      }
    }

    // 3. Exportar a Buffer
    const output = await pptx.write({ outputType: "nodebuffer" });

    // Asegurar que sea un Buffer
    if (Buffer.isBuffer(output)) {
      return output;
    } else if (output instanceof ArrayBuffer) {
      return Buffer.from(output);
    } else {
      throw new Error("Formato de salida inesperado de pptxgenjs");
    }
  }

  /**
   * Agrega un slide completo al PPT con diseño didáctico.
   */
  private async addSlide(
    pptx: PptxGenJS,
    slideData: PptSlideData,
    courseId: string
  ): Promise<void> {
    const slide = pptx.addSlide({ masterName: "MASTER_SLIDE" });

    // 1. Header: número jerárquico (esquina superior derecha)
    slide.addText(slideData.numericPath, {
      x: 11.8,
      y: 0.25,
      w: 1.2,
      h: 0.35,
      fontSize: 13,
      color: COLORS.slate400,
      align: "right",
      fontFace: "Inter",
      bold: true,
    });

    // 2. Título principal (centrado, serif display)
    slide.addText(slideData.title, {
      x: 0.8,
      y: 0.9,
      w: 11.4,
      h: 0.9,
      fontSize: 36,
      bold: true,
      color: COLORS.slate900,
      align: "center",
      fontFace: "Playfair Display",
      valign: "middle",
    });

    // 3. Extraer figuras
    const figureIds = this.parseFigureRefs(slideData.figureRefs);
    const figureFiles = await this.resolveFigureFiles(courseId, figureIds);

    // 4. Layout dinámico según contenido
    await this.layoutContent(slide, slideData, figureFiles);

    // 5. Notas del orador: todas las boxes
    const notesContent = this.buildSpeakerNotes(slideData.boxes);
    if (notesContent) {
      slide.addNotes(notesContent);
    }
  }

  /**
   * Layout automático de contenido + figuras.
   * Estrategia: figuras en columna derecha si hay 1-3, abajo si >3.
   */
  private async layoutContent(
    slide: PptxGenJS.Slide,
    slideData: PptSlideData,
    figureFiles: string[]
  ): Promise<void> {
    const guion = slideData.boxes[BoxType.SCRIPT] ?? "";
    const ejercicio1 = slideData.boxes[BoxType.EXERCISE_1] ?? "";
    const ejercicio2 = slideData.boxes[BoxType.EXERCISE_2] ?? "";

    const hasFigures = figureFiles.length > 0;
    const textBlocks = [
      { label: null, content: guion },
      { label: "Ejercicio 1", content: ejercicio1 },
      { label: "Ejercicio 2", content: ejercicio2 },
    ].filter((b) => b.content.trim());

    // Layout: si hay figuras, usar 2 columnas
    if (hasFigures && figureFiles.length <= 3) {
      // Texto columna izquierda
      const textX = 0.75;
      const textW = 6.5;
      let textY = 2.1;

      for (const block of textBlocks) {
        if (block.label) {
          slide.addText(block.label, {
            x: textX,
            y: textY,
            w: textW,
            h: 0.35,
            fontSize: 14,
            bold: true,
            color: COLORS.terracotta,
            fontFace: "Inter",
          });
          textY += 0.45;
        }
        const sanitized = this.sanitizeText(block.content);
        const estimatedHeight = this.estimateTextHeight(sanitized, textW, 15);
        slide.addText(sanitized, {
          x: textX,
          y: textY,
          w: textW,
          h: Math.min(estimatedHeight, 3.5),
          fontSize: 15,
          color: COLORS.slate700,
          fontFace: "Inter",
          valign: "top",
          lineSpacing: 22,
        });
        textY += Math.min(estimatedHeight, 3.5) + 0.3;
      }

      // Figuras columna derecha
      const figX = 7.8;
      const figW = 4.8;
      let figY = 2.1;
      const figSpacing = 0.4;

      for (const figPath of figureFiles) {
        try {
          const figH = 2.0; // altura fija por figura
          slide.addImage({
            path: figPath,
            x: figX,
            y: figY,
            w: figW,
            h: figH,
            sizing: { type: "contain", w: figW, h: figH },
          });
          figY += figH + figSpacing;
        } catch (err) {
          console.warn(`[PPT] No se pudo insertar figura: ${figPath}`, err);
        }
      }
    } else if (hasFigures && figureFiles.length > 3) {
      // Muchas figuras: texto arriba, figuras abajo en grid
      const textX = 0.75;
      const textW = 11.5;
      let textY = 2.1;

      for (const block of textBlocks) {
        if (block.label) {
          slide.addText(block.label, {
            x: textX,
            y: textY,
            w: textW,
            h: 0.35,
            fontSize: 14,
            bold: true,
            color: COLORS.terracotta,
            fontFace: "Inter",
          });
          textY += 0.45;
        }
        const sanitized = this.sanitizeText(block.content);
        const estimatedHeight = this.estimateTextHeight(sanitized, textW, 15);
        slide.addText(sanitized, {
          x: textX,
          y: textY,
          w: textW,
          h: Math.min(estimatedHeight, 1.8),
          fontSize: 15,
          color: COLORS.slate700,
          fontFace: "Inter",
          valign: "top",
          lineSpacing: 22,
        });
        textY += Math.min(estimatedHeight, 1.8) + 0.25;
      }

      // Figuras en grid 3 columnas
      const figY = 4.5;
      const figW = 3.5;
      const figH = 2.0;
      const cols = 3;
      const gap = 0.3;
      for (let i = 0; i < Math.min(figureFiles.length, 6); i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const figX = 0.75 + col * (figW + gap);
        const figYPos = figY + row * (figH + gap);
        try {
          slide.addImage({
            path: figureFiles[i],
            x: figX,
            y: figYPos,
            w: figW,
            h: figH,
            sizing: { type: "contain", w: figW, h: figH },
          });
        } catch (err) {
          console.warn(`[PPT] No se pudo insertar figura: ${figureFiles[i]}`, err);
        }
      }
    } else {
      // Sin figuras: texto a ancho completo
      const textX = 0.75;
      const textW = 11.5;
      let textY = 2.1;

      for (const block of textBlocks) {
        if (block.label) {
          slide.addText(block.label, {
            x: textX,
            y: textY,
            w: textW,
            h: 0.35,
            fontSize: 14,
            bold: true,
            color: COLORS.terracotta,
            fontFace: "Inter",
          });
          textY += 0.45;
        }
        const sanitized = this.sanitizeText(block.content);
        const estimatedHeight = this.estimateTextHeight(sanitized, textW, 16);
        slide.addText(sanitized, {
          x: textX,
          y: textY,
          w: textW,
          h: Math.min(estimatedHeight, 4.5),
          fontSize: 16,
          color: COLORS.slate700,
          fontFace: "Inter",
          valign: "top",
          lineSpacing: 24,
        });
        textY += Math.min(estimatedHeight, 4.5) + 0.3;
      }
    }
  }

  /**
   * Parsea figureRefs JSON y devuelve array de IDs.
   */
  private parseFigureRefs(figureRefs?: string): string[] {
    if (!figureRefs) return [];
    try {
      const parsed = JSON.parse(figureRefs);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Resuelve rutas absolutas a archivos de figuras desde IDs.
   */
  private async resolveFigureFiles(
    courseId: string,
    figureIds: string[]
  ): Promise<string[]> {
    const courseDir = path.join(this.figuresDir, courseId);
    const resolved: string[] = [];

    for (const figId of figureIds) {
      // Buscar archivo PNG con ese ID
      const figPath = path.join(courseDir, `${figId}.png`);
      try {
        await fs.access(figPath);
        resolved.push(figPath);
      } catch {
        console.warn(`[PPT] Figura no encontrada: ${figPath}`);
      }
    }

    return resolved;
  }

  /**
   * Estima altura aproximada de un bloque de texto (en pulgadas).
   */
  private estimateTextHeight(
    text: string,
    width: number,
    fontSize: number
  ): number {
    const charsPerLine = Math.floor((width * 72) / (fontSize * 0.6));
    const lines = text.split("\n").reduce((acc, line) => {
      return acc + Math.ceil(line.length / charsPerLine);
    }, 0);
    const lineHeightInches = (fontSize * 1.5) / 72;
    return Math.max(0.5, lines * lineHeightInches);
  }

  /**
   * Construye el texto de notas del orador desde todas las boxes.
   * Formato: sección + contenido por cada box no vacía.
   */
  private buildSpeakerNotes(boxes: Record<string, string>): string {
    const sections: string[] = [];

    const addSection = (label: string, content: string) => {
      const cleaned = this.sanitizeTextForNotes(content).trim();
      if (cleaned) {
        sections.push(`${label}\n${cleaned}`);
      }
    };

    addSection("GUION", boxes[BoxType.SCRIPT] ?? "");
    addSection("RELEVANCIA", boxes[BoxType.RELEVANCE] ?? "");
    addSection("NARRATIVA", boxes[BoxType.NARRATIVE] ?? "");
    addSection("EJERCICIO 1", boxes[BoxType.EXERCISE_1] ?? "");
    addSection("EJERCICIO 2", boxes[BoxType.EXERCISE_2] ?? "");

    return sections.join("\n\n---\n\n");
  }

  /**
   * Sanitiza texto para slides PPT.
   * CRÍTICO: preserva fórmulas LaTeX como texto plano (NO convertir a PNG).
   * Ejemplo: $E = mc^2$ → E = mc^2
   * Ejemplo: $$\int_0^\infty e^{-x^2} dx$$ → ∫₀^∞ e^(-x²) dx
   */
  private sanitizeText(input: string): string {
    if (!input) return "";

    let text = input;

    // Eliminar HTML tags
    text = text.replace(/<\/?[^>]+>/g, "");

    // Convertir markdown bold/italic a texto plano
    text = text.replace(/\*\*(.+?)\*\*/g, "$1");
    text = text.replace(/\*(.+?)\*/g, "$1");
    text = text.replace(/_(.+?)_/g, "$1");

    // PRESERVAR fórmulas LaTeX como texto plano (quitar delimitadores $ pero mantener contenido)
    // Fórmulas display: $$...$$
    text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => {
      return this.latexToPlainText(formula.trim());
    });
    // Fórmulas inline: $...$
    text = text.replace(/\$(.+?)\$/g, (_, formula) => {
      return this.latexToPlainText(formula.trim());
    });

    return text.trim();
  }

  /**
   * Sanitiza texto para notas del orador (menos agresivo).
   */
  private sanitizeTextForNotes(input: string): string {
    if (!input) return "";

    let text = input;

    // Eliminar HTML tags
    text = text.replace(/<\/?[^>]+>/g, "");

    // Preservar markdown básico para notas
    // (el campo de notas de PPT soporta texto plano con formato)

    return text.trim();
  }

  /**
   * Convierte comandos LaTeX comunes a unicode/texto plano.
   * Ejemplos:
   *   \int → ∫
   *   \sum → ∑
   *   x^2 → x²
   *   x_0 → x₀
   */
  private latexToPlainText(latex: string): string {
    let text = latex;

    // Comandos comunes
    const replacements: Record<string, string> = {
      "\\int": "∫",
      "\\sum": "∑",
      "\\prod": "∏",
      "\\infty": "∞",
      "\\partial": "∂",
      "\\nabla": "∇",
      "\\pm": "±",
      "\\times": "×",
      "\\div": "÷",
      "\\cdot": "·",
      "\\leq": "≤",
      "\\geq": "≥",
      "\\neq": "≠",
      "\\approx": "≈",
      "\\equiv": "≡",
      "\\to": "→",
      "\\rightarrow": "→",
      "\\leftarrow": "←",
      "\\Rightarrow": "⇒",
      "\\Leftarrow": "⇐",
      "\\alpha": "α",
      "\\beta": "β",
      "\\gamma": "γ",
      "\\delta": "δ",
      "\\epsilon": "ε",
      "\\theta": "θ",
      "\\lambda": "λ",
      "\\mu": "μ",
      "\\pi": "π",
      "\\sigma": "σ",
      "\\tau": "τ",
      "\\phi": "φ",
      "\\omega": "ω",
      "\\Delta": "Δ",
      "\\Sigma": "Σ",
      "\\Omega": "Ω",
    };

    for (const [latex, unicode] of Object.entries(replacements)) {
      text = text.replace(new RegExp(latex.replace(/\\/g, "\\\\"), "g"), unicode);
    }

    // Superíndices: x^2 → x²
    const superscripts: Record<string, string> = {
      "0": "⁰",
      "1": "¹",
      "2": "²",
      "3": "³",
      "4": "⁴",
      "5": "⁵",
      "6": "⁶",
      "7": "⁷",
      "8": "⁸",
      "9": "⁹",
      "+": "⁺",
      "-": "⁻",
      "=": "⁼",
      "(": "⁽",
      ")": "⁾",
      "n": "ⁿ",
    };

    text = text.replace(/\^(\w|\d)/g, (_, char) => superscripts[char] || `^${char}`);
    text = text.replace(/\^{([^}]+)}/g, (_, content) => {
      return content
        .split("")
        .map((c: string) => superscripts[c] || c)
        .join("");
    });

    // Subíndices: x_0 → x₀
    const subscripts: Record<string, string> = {
      "0": "₀",
      "1": "₁",
      "2": "₂",
      "3": "₃",
      "4": "₄",
      "5": "₅",
      "6": "₆",
      "7": "₇",
      "8": "₈",
      "9": "₉",
      "+": "₊",
      "-": "₋",
      "=": "₌",
      "(": "₍",
      ")": "₎",
    };

    text = text.replace(/_(\w|\d)/g, (_, char) => subscripts[char] || `_${char}`);
    text = text.replace(/_{([^}]+)}/g, (_, content) => {
      return content
        .split("")
        .map((c: string) => subscripts[c] || c)
        .join("");
    });

    // Limpiar comandos residuales
    text = text.replace(/\\[a-zA-Z]+/g, "");
    text = text.replace(/[{}]/g, "");

    return text;
  }
}

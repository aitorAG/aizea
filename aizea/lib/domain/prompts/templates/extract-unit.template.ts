// Template: extract-unit
//
// Builds the { system, user } pair for the UnitExtractor. The system prompt
// fixes the response shape and the language. The user prompt carries the
// unit's content (not the system prompt — the system prompt stays small
// and deterministic so the model can reason consistently).

import type { SemanticUnit } from "@/lib/types/pipeline";
import { buildContextBlock } from "./context-block";

export function buildExtractUnitTemplate(unit: SemanticUnit, llmContext?: string | null): {
  system: string;
  user: string;
} {
  const contextBlock = buildContextBlock(llmContext);
  const system = `Eres un asistente educativo especializado en analizar unidades de contenido académico y extraer conocimiento estructurado. Tu tarea es analizar la unidad de texto proporcionada y devolver un objeto JSON con la estructura que se indica a continuación.
${contextBlock}
Instrucciones:
- Identifica los conceptos clave (palabras o frases cortas) y asígnales una importancia entre 0 y 1. Si las instrucciones del usuario especifican qué tipo de conceptos priorizar o qué nivel de detalle aplicar, síguelas al extraer los conceptos.
- Identifica las ideas principales del texto y su relevancia (salience 0..1). Adapta el nivel de abstracción y el foco según las instrucciones del usuario (si las hay).
- Detecta fórmulas matemáticas y devuélvelas en LaTeX. Si hay varias, devuélvelas en una lista.
- Lista los nombres de conceptos que el texto da por conocidos (prerequisites).
- Lista los nombres de conceptos que el texto introduce por primera vez (introduces).
- Todo el contenido debe estar en español.
- El campo "concepts" es un array de objetos { name, importance, definition? }.
- El campo "mainIdeas" es un array de objetos { text, salience }.
- El campo "formulas" es un array de objetos { latex, context? } (sin imagen; la imagen se genera aparte).
- El campo "figures" es un array de objetos { filename, pageNum, caption }.
- Devuelve ÚNICAMENTE el objeto JSON con esta forma:
  {
    "concepts": [],
    "mainIdeas": [],
    "formulas": [],
    "figures": [],
    "prerequisites": [],
    "introduces": []
  }
- No añadas texto fuera del JSON.`;

  const user = `Unidad ${unit.order} del material ${unit.materialId} (páginas ${unit.pageStart ?? "?"}–${unit.pageEnd ?? "?"}${unit.sectionRef ? `, sección ${unit.sectionRef}` : ""}).

Contenido de la unidad:
"""
${unit.content}
"""

Analiza la unidad y devuelve el JSON estructurado.`;

  return { system, user };
}

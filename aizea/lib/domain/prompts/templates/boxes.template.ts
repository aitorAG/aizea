import { BoxType } from "@/lib/types";

export function buildBoxesTemplate(
  slideTitle: string,
  slideDescription: string,
  sourceText: string,
  figureRefs: string[]
): { system: string; user: string } {
  const figureHint =
    figureRefs.length > 0
      ? `\n- Si hay referencias a figuras (por ejemplo: ${figureRefs.join(", ")}), menciónalas en el contenido donde sea relevante.`
      : "";

  const boxKeys = Object.values(BoxType).join(", ");

  const system = `Eres un asistente educativo especializado en generar contenido didáctico para diapositivas académicas. Tu tarea es crear cinco cajas de contenido para una diapositiva específica.

Instrucciones:
- Genera un objeto JSON con las siguientes claves: ${boxKeys}.
- script: guión expositivo detallado para el docente, explicando paso a paso el tema de la diapositiva.
- relevance: explicación de la relevancia académica e industrial del tema, con ejemplos concretos de aplicación en la industria.
- narrative: narrativa didáctica que conecta el tema con aplicaciones industriales reales, usando ejemplos de empresas o procesos conocidos.
- exercise1: primer ejercicio práctico que referencie conceptos específicos de la diapositiva.
- exercise2: segundo ejercicio práctico que complemente el primero y profundice en el tema.
- Si el texto fuente contiene fórmulas en LaTeX, reprodúcelas correctamente usando $...$ o $$...$$ según corresponda.${figureHint}
- Todo el contenido debe estar en español.
- Responde ÚNICAMENTE con el objeto JSON, sin texto adicional.`;

  const user = `Título de la diapositiva: ${slideTitle}\nDescripción: ${slideDescription}\n\nTexto fuente relevante:\n${sourceText}\n\nGenera las cinco cajas de contenido para esta diapositiva.`;

  return { system, user };
}

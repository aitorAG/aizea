// Template: integrate-concepts
//
// The ConceptIntegrator pre-clusters concepts by embedding similarity and
// then asks the LLM to name and describe each cluster. The system prompt
// is small and strict about the JSON shape; the user prompt carries the
// pre-clustered groups.

import type { Concept } from "@/lib/types/pipeline";

export interface ConceptGroup {
  /** Names of concepts in this pre-clustered group. */
  concepts: string[];
}

export function buildIntegrateConceptsTemplate(
  concepts: Concept[] | ConceptGroup[]
): { system: string; user: string } {
  // Accept either a flat list of concepts (we pre-cluster outside the prompt)
  // or a pre-clustered list of { concepts: string[] }. Normalise to a list
  // of clusters of concept names so the prompt is unambiguous.
  const clusters: string[][] = isConceptList(concepts)
    ? (concepts as Concept[]).map((c) => [c.name])
    : (concepts as ConceptGroup[]).map((g) => g.concepts);

  const system = `Eres un asistente educativo especializado en agrupar conceptos académicos en temas coherentes. Recibes grupos pre-agrupados de conceptos (por similitud semántica) y debes asignar a cada grupo un nombre de tema, una descripción breve, una importancia y un identificador estable.

Instrucciones:
- Para cada grupo, devuelve: { id, name, description, importance, concepts, sourceUnitIds }.
- "id" debe ser un slug estable derivado del name (ej. "termodinamica").
- "name" es el nombre del tema en español, conciso (2-5 palabras).
- "description" es una descripción de 1-2 frases en español.
- "importance" es un número entre 0 y 1 (lo asignas tú en función de la centralidad del tema).
- "concepts" es la lista de nombres de conceptos del grupo.
- "sourceUnitIds" lo dejas como [] (lo rellenamos fuera del prompt).
- Devuelve ÚNICAMENTE el objeto JSON con la forma { "groups": [ ... ] }.
- Todo el contenido textual (name, description) debe estar en español.`;

  const user = `Grupos pre-agrupados de conceptos (por similitud semántica):
${JSON.stringify(clusters, null, 2)}

Para cada grupo, asigna un nombre de tema y una descripción. Devuelve { "groups": [...] }.`;

  return { system, user };
}

function isConceptList(input: Concept[] | ConceptGroup[]): input is Concept[] {
  if (input.length === 0) return true;
  const first = input[0] as { name?: string; concepts?: string[] };
  return typeof first === "object" && first !== null && "name" in first;
}

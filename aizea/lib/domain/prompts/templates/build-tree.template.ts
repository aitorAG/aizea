// Template: build-tree
//
// The TreeBuilder asks the LLM to organise a flat list of TopicGroups into
// a 2-4 level hierarchy. The response is a JSON object with `nodes` (flat
// list of { id, name, summary, parentRef, depth }) and `roots` (refs to
// the top-level nodes). The application code then resolves the references
// to actual database ids.

import type { TopicGroup } from "@/lib/types/pipeline";

export function buildBuildTreeTemplate(groups: TopicGroup[]): {
  system: string;
  user: string;
} {
  const system = `Eres un asistente educativo especializado en organizar temas académicos en jerarquías pedagógicas. Recibes una lista de temas (TopicGroup) y debes organizarlos en un árbol de 2 a 4 niveles.

Instrucciones:
- Devuelve un objeto JSON con la forma:
  {
    "nodes": [
      { "ref": "n1", "name": "Física", "summary": "Rama de la ciencia", "parentRef": null, "depth": 0 },
      { "ref": "n2", "name": "Termodinámica", "summary": "Calor y energía", "parentRef": "n1", "depth": 1 },
      ...
    ],
    "roots": ["n1"]
  }
- "ref" es un identificador local (n1, n2, ...). Los que ya tienen id (g-xxx) pueden reusarse como ref.
- "depth" es 0-based: 0 = raíz, 1 = hijo, 2 = nieto, 3 = bisnieto.
- La jerarquía debe tener profundidad 2-4 (entre 1 y 3 niveles de hijos bajo la raíz).
- No crees ciclos.
- Cada nodo debe tener al menos un hijo si depth < 3, salvo los nodos hoja que correspondan a los grupos originales.
- Si un grupo no encaja claramente bajo ninguna raíz, déjalo como raíz propia.
- El campo "summary" debe estar en español.
- El campo "name" debe estar en español.
- Devuelve ÚNICAMENTE el objeto JSON.`;

  const user = `Lista de temas a organizar en jerarquía:
${JSON.stringify(
  groups.map((g) => ({
    ref: g.id,
    name: g.name,
    description: g.description,
    concepts: g.concepts,
    importance: g.importance,
  })),
  null,
  2
)}

Construye la jerarquía.`;

  return { system, user };
}

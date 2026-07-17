import type { TopicNode } from "@/lib/types/pipeline";

/**
 * Build the prompt for organising a set of TopicNodes into a pedagogically
 * ordered slide outline. The LLM does NOT invent content — the slides are
 * created one-per-node by the caller, using `node.name` and `node.summary`.
 * The LLM's only job is to return the nodes in the best order for teaching.
 */
export function buildOutlineTemplate(
  nodes: TopicNode[]
): { system: string; user: string } {
  const system = `Eres un asistente educativo especializado en ordenar temas de un curso en una secuencia pedagógica óptima.

Instrucciones:
- Recibirás una lista de nodos de un árbol conceptual. Cada nodo tiene un id, un nombre y un resumen.
- Tu única tarea es REORDENAR los nodos en el orden pedagógico más efectivo para una clase: de conceptos básicos/fundacionales a avanzados/aplicados, agrupando temas afines.
- NO inventes contenido, NO cambies los nombres ni resúmenes, NO añadas diapositivas nuevas.
- Responde ÚNICAMENTE con un objeto JSON con la forma {"order": ["<id1>", "<id2>", ...]} donde la lista contiene exactamente los mismos ids que recibiste, en el orden recomendado.
- El contenido debe estar en español.`;

  const compact = nodes.map((n) => ({
    id: n.id,
    name: n.name,
    summary: n.summary ?? "",
  }));

  const user = `Nodos del árbol a ordenar (${nodes.length} en total):

${JSON.stringify(compact, null, 2)}

Devuelve el orden pedagógico recomendado como {"order": [...]}.`;

  return { system, user };
}

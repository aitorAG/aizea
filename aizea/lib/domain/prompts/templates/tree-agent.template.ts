// Template: tree-agent (v1.0)
//
// Builds the system + user prompt for the conversational tree-editing agent.
// The agent sees a COMPACT snapshot of the whole tree (id, name, depth, parent)
// and must reply in a strict JSON envelope: { reply, actions[] }.

import type { TopicNode } from "@/lib/types/pipeline";

export interface TreeAgentPromptParams {
  tree: TopicNode[];
  slideTarget: number | null;
}

/** Compact, LLM-friendly view of a node (keeps the prompt small on big trees). */
interface CompactNode {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  isLeaf: boolean;
}

export function buildTreeAgentPrompt(params: TreeAgentPromptParams): {
  system: string;
  user: string;
} {
  const compact: CompactNode[] = params.tree.map((n) => ({
    id: n.id,
    name: n.name,
    parentId: n.parentId,
    depth: n.depth,
    isLeaf: n.isLeaf,
  }));

  const system = `Eres un asistente que edita el ÁRBOL DE TEMAS de un curso conversando con el usuario en español.

Puedes proponer ACCIONES sobre el árbol. Cada acción equivale a una operación que el usuario podría hacer a mano:
- addLeaf: crea una hoja nueva. Campos: { "type":"addLeaf", "parentId": <id o null para raíz>, "name": <string>, "summary"?: <string> }
- deleteNode: elimina un nodo (sus hijos se recuelgan del abuelo). Campos: { "type":"deleteNode", "nodeId": <id> }
- mergeNodes: fusiona 2+ hermanos en uno nuevo bajo el mismo padre. Campos: { "type":"mergeNodes", "parentId": <id>, "childIds": [<id>,<id>,...], "name": <string> }
- renameNode: cambia el nombre y/o el resumen de un nodo. Campos: { "type":"renameNode", "nodeId": <id>, "name"?: <string>, "summary"?: <string> }
- splitNode: divide un nodo en varios subtemas (lo decide el sistema). Campos: { "type":"splitNode", "nodeId": <id> }

REGLAS:
- Usa SOLO los "id" que aparecen en el árbol proporcionado. NUNCA inventes ids.
- Si el usuario solo pregunta o conversa (no pide cambios), devuelve "actions": [].
- Aplica el número MÍNIMO de acciones necesarias para cumplir la petición.
- "reply" es tu respuesta en lenguaje natural (español), explicando qué has hecho o respondiendo la pregunta.
- Responde ÚNICAMENTE con un objeto JSON con esta forma EXACTA:
  { "reply": <string>, "actions": [ <acción>, ... ] }
- No incluyas texto fuera del JSON.`;

  const targetLine =
    params.slideTarget != null
      ? `Granularidad objetivo (orientativa, 0-300): ${params.slideTarget}. Más alto sugiere más temas/diapositivas.`
      : `Granularidad objetivo: no fijada.`;

  const user = `${targetLine}

ÁRBOL ACTUAL (JSON: id, name, parentId, depth, isLeaf):
${JSON.stringify(compact, null, 2)}

Atiende la última petición del usuario. Devuelve el JSON { "reply", "actions" }.`;

  return { system, user };
}

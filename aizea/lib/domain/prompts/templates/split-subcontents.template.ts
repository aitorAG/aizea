// Template: split-subcontents
//
// The splitTreeNodeAction asks the LLM to analyse a node's content and
// propose a small set of sub-contents that would make sense as separate
// child boxes. The response is a JSON object with a `subcontents` array
// of { name, summary }. The caller validates the shape and creates one
// TopicNode per entry.
//
// The LLM does NOT see the broader tree — only the single node's
// current name and summary. Keeping the input narrow gives the model
// the right scope: it should subdivide THIS content, not invent
// material from the rest of the course.

export interface SubcontentProposal {
  name: string;
  summary: string;
}

/**
 * Build the system+user prompt pair for proposing sub-contents of a
 * single node during a Split action.
 */
export function buildSplitSubcontentsTemplate(
  nodeName: string,
  nodeSummary: string | null
): { system: string; user: string } {
  const system = `Eres un asistente educativo especializado en estructurar contenido pedagógico.

Tarea:
- Recibirás el nombre y, opcionalmente, un resumen de un nodo de un árbol conceptual.
- Tu única tarea es proponer entre 2 y 5 sub-contenidos que tengan sentido como hijos separados de ese nodo, respetando la coherencia temática.
- Cada sub-contenido debe cubrir un aspecto distinto y relevante del nodo original. No repitas ni parafrasees el nodo padre.
- Los nombres deben ser concisos (máximo 60 caracteres) y los resúmenes deben tener UNA frase corta (máximo 200 caracteres) en español.
- Responde ÚNICAMENTE con un objeto JSON con la forma:
  {
    "subcontents": [
      { "name": "<título>", "summary": "<resumen en una frase>" },
      ...
    ]
  }
- El array "subcontents" debe contener entre 2 y 5 elementos. Si el nodo es demasiado simple para subdividir, devuelve exactamente 2 sub-contenidos que representen la división natural del contenido.
- Todo el contenido debe estar en español.`;

  const user = `Nodo a subdividir:
- Nombre: ${nodeName}
- Resumen: ${nodeSummary && nodeSummary.trim().length > 0 ? nodeSummary : "(sin resumen)"}

Propón los sub-contenidos como {"subcontents": [...]}.`;

  return { system, user };
}

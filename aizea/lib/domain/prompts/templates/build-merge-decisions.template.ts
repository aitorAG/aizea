// Template: build-merge-decisions (PR4 — IncrementalMerger).
//
// The IncrementalMerger computes, for each NEW concept extracted from a newly
// uploaded material, a local decision by cosine similarity against the
// existing TopicNode tree:
//   - "same":  the concept already exists → enrich, don't add a node.
//   - "child": it's a sub-topic of an existing node → add under parentRef.
//   - "new":   unrelated → add as a new root.
//
// This prompt asks the LLM to VALIDATE / ADJUST those local decisions with
// full knowledge of the existing tree. It returns a JSON object shaped
// EXACTLY as the merger consumes it:
//   { decisions: [ { concept, action, parentRef?, name?, description? } ] }
//
// Previously the merger reused the integrate-concepts prompt, which never
// asked for `action`/`parentRef`, so validation always fell back to the raw
// cosine decision (P7). This template fixes that.

export interface MergeDecisionInput {
  /** The new concept name. */
  concept: string;
  /** Local cosine decision to validate. */
  suggestedAction: "same" | "child" | "new";
  /** Existing node id the cosine match points at (for same/child), or null. */
  targetId: string | null;
  /** Cosine similarity of the best match [0,1]. */
  similarity: number;
}

export interface MergeExistingNode {
  id: string;
  name: string;
  depth: number;
  parentId: string | null;
}

export function buildMergeDecisionsTemplate(
  decisions: MergeDecisionInput[],
  existing: MergeExistingNode[]
): { system: string; user: string } {
  const system = `Eres un asistente educativo que mantiene un árbol de temas (TopicNode) coherente al incorporar material nuevo. Recibes:
1. El árbol EXISTENTE (lista de nodos con id, name, depth, parentId).
2. Una lista de CONCEPTOS NUEVOS, cada uno con una decisión provisional calculada por similitud vectorial (suggestedAction) y el nodo candidato (targetId).

Tu tarea: confirmar o corregir cada decisión usando tu conocimiento del árbol. Para cada concepto devuelve un objeto con:
- "concept": el nombre exacto del concepto nuevo (cópialo tal cual).
- "action": "same" | "child" | "new".
    · "same"  = el concepto YA está representado por un nodo existente (no se crea nodo).
    · "child" = es un subtema de un nodo existente → indica "parentRef" con el id de ese nodo.
    · "new"   = no encaja bajo ningún nodo → será una nueva raíz.
- "parentRef": OBLIGATORIO si action="child" (id de un nodo existente); null en otro caso.
- "name": (opcional) nombre mejorado del tema en español.
- "description": (opcional) breve descripción en español.

Reglas:
- "parentRef" DEBE ser un id que aparezca en el árbol existente. Nunca inventes ids.
- No crees ciclos: un concepto nuevo nunca puede ser padre de un nodo existente.
- Respeta una profundidad máxima de 4 niveles (depth 0..3). Si el padre candidato ya está a depth 3, prefiere "same" o reubica a un ancestro.
- Ante la duda, respeta la suggestedAction salvo que sea claramente incorrecta.
- Devuelve ÚNICAMENTE el objeto JSON con la forma { "decisions": [...] }.`;

  const user = `Árbol EXISTENTE:
${JSON.stringify(
  existing.map((n) => ({ id: n.id, name: n.name, depth: n.depth, parentId: n.parentId })),
  null,
  2
)}

CONCEPTOS NUEVOS a decidir:
${JSON.stringify(
  decisions.map((d) => ({
    concept: d.concept,
    suggestedAction: d.suggestedAction,
    targetId: d.targetId,
    similarity: Number(d.similarity.toFixed(3)),
  })),
  null,
  2
)}

Devuelve el objeto JSON { "decisions": [...] }.`;

  return { system, user };
}

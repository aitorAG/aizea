// Shared helper: build a "user instructions" context block for pipeline prompts.
//
// The user can provide free-form instructions when creating a course (stored in
// Course.llmContext / generationInstructions). These instructions steer how the
// LLM segments, integrates and structures the conceptual tree. This helper
// renders those instructions as a prominent, clearly-delimited block that is
// injected into the system prompt of each pipeline phase (extract-unit,
// integrate-concepts, build-tree).
//
// When there are no instructions the helper returns an empty string so the
// prompt stays identical to the legacy behaviour (no dangling headers).

export function buildContextBlock(llmContext?: string | null): string {
  const trimmed = (llmContext ?? "").trim();
  if (trimmed.length === 0) return "";

  return `
INSTRUCCIONES DEL USUARIO (PRIORITARIAS — síguelas al pie de la letra):
"""
${trimmed}
"""
Estas instrucciones definen el enfoque, el nivel, el tono y la estructura que el usuario espera. Respétalas en todas tus decisiones.
`;
}

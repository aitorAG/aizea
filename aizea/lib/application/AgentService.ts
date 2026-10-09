// AgentService (v1.0) — conversational tree-editing agent.
//
// The agent receives the FULL tree, the conversation so far and the course's
// slideTarget, and returns a natural-language reply PLUS a list of structured
// ACTIONS to apply to the tree. Actions map 1:1 to the existing tree-edit
// operations (add / delete / merge / rename / split), so the agent can only do
// what a user could do by hand — the server action executes them through the
// same TreeService path (single source of truth, same validation).
//
// v1.0 uses a JSON envelope over `ILLMProvider.chatJSON` (multi-turn, JSON mode)
// rather than native tool-calling: the envelope is provider-agnostic, already
// battle-tested across this codebase, and the tool-calling vs envelope choice
// is invisible to the user. The reply arrives complete for the turn; the client
// applies mutations live with `setNodes` (no page reload) — the real-time
// mechanism the tree view already supports.
//
// Pure domain logic: depends only on ILLMProvider (injected). No DB, no infra.

import type { ILLMProvider, ChatMessage } from "@/lib/application/ports/llm-provider.port";
import type { TopicNode } from "@/lib/types/pipeline";
import { buildTreeAgentPrompt } from "@/lib/domain/prompts/templates/tree-agent.template";
import { RAGEngine } from "@/lib/domain/rag/RAGEngine";

/** One conversational turn as seen by the agent. */
export interface AgentTurn {
  role: "user" | "assistant";
  content: string;
}

/** Structured actions the agent may request. Each maps to a TreeService op. */
export type AgentAction =
  | { type: "addLeaf"; parentId: string | null; name: string; summary?: string }
  | { type: "deleteNode"; nodeId: string }
  | { type: "mergeNodes"; parentId: string; childIds: string[]; name: string }
  | { type: "renameNode"; nodeId: string; name?: string; summary?: string }
  | { type: "splitNode"; nodeId: string };

/** Raw envelope the LLM returns. Validated/normalised before use. */
interface AgentEnvelope {
  reply?: unknown;
  actions?: unknown;
}

export interface AgentResult {
  /** Natural-language reply to show in the chat. */
  reply: string;
  /** Validated actions to execute against the tree, in order. */
  actions: AgentAction[];
}

const VALID_TYPES = new Set([
  "addLeaf",
  "deleteNode",
  "mergeNodes",
  "renameNode",
  "splitNode",
]);

export class AgentService {
  constructor(
    private readonly llm: ILLMProvider,
    private readonly ragEngine?: RAGEngine
  ) {}

  /**
   * Run one agent turn. Returns the reply and the (validated) actions to apply.
   * Never throws for a malformed LLM response — it degrades to a reply with no
   * actions so the chat stays usable.
   * 
   * If materialIds are provided and the query is detected as RAG, responds
   * using information from course materials instead of editing the tree.
   */
  async run(params: {
    tree: TopicNode[];
    history: AgentTurn[];
    slideTarget: number | null;
    llmContext: string | null;
    materialIds?: string[];
  }): Promise<AgentResult> {
    // Get the latest user message for classification
    const latestUserMessage = params.history
      .filter((turn) => turn.role === "user")
      .slice(-1)[0]?.content;

    // If we have materials and the query looks like RAG, handle via RAG
    if (
      latestUserMessage &&
      params.materialIds &&
      params.materialIds.length > 0 &&
      this.ragEngine
    ) {
      const queryType = await this.classifyQuery(latestUserMessage);
      if (queryType === "rag") {
        const ragReply = await this.queryMaterialsRAG({
          query: latestUserMessage,
          materialIds: params.materialIds,
        });
        return { reply: ragReply, actions: [] };
      }
    }

    // Otherwise, handle as tree-editing agent
    const { system, user } = buildTreeAgentPrompt({
      tree: params.tree,
      slideTarget: params.slideTarget,
      llmContext: params.llmContext,
    });

    const messages: ChatMessage[] = [{ role: "system", content: system }];
    for (const turn of params.history) {
      messages.push({ role: turn.role, content: turn.content });
    }
    // The latest user turn is already the last item in history; the `user`
    // block carries the current tree snapshot + task framing.
    messages.push({ role: "user", content: user });

    let envelope: AgentEnvelope;
    try {
      envelope = await this.llm.chatJSON<AgentEnvelope>(messages);
    } catch {
      return {
        reply:
          "No he podido procesar la petición ahora mismo. Inténtalo de nuevo.",
        actions: [],
      };
    }

    const reply =
      typeof envelope?.reply === "string" && envelope.reply.trim().length > 0
        ? envelope.reply.trim()
        : "Hecho.";
    const actions = this.validateActions(envelope?.actions, params.tree);
    return { reply, actions };
  }

  /**
   * Classify user query as either RAG (information lookup) or tree editing.
   * Returns 'rag' if the query is asking about course content/materials,
   * 'edit' if it's requesting changes to the tree structure.
   */
  private async classifyQuery(query: string): Promise<"rag" | "edit"> {
    const ragKeywords = [
      "qué dice",
      "qué explica",
      "qué contiene",
      "cuál es",
      "cómo se define",
      "busca",
      "encuentra",
      "dime sobre",
      "información sobre",
      "contenido sobre",
      "según el material",
      "según los materiales",
    ];

    const editKeywords = [
      "añade",
      "agrega",
      "crea",
      "elimina",
      "borra",
      "renombra",
      "cambia",
      "modifica",
      "divide",
      "une",
      "fusiona",
      "reorganiza",
    ];

    const lowerQuery = query.toLowerCase();

    // Count keyword matches
    const ragMatches = ragKeywords.filter((kw) => lowerQuery.includes(kw)).length;
    const editMatches = editKeywords.filter((kw) => lowerQuery.includes(kw)).length;

    // If edit keywords dominate, classify as edit
    if (editMatches > ragMatches) return "edit";

    // If RAG keywords dominate, classify as rag
    if (ragMatches > editMatches) return "rag";

    // For ambiguous cases, use LLM to classify
    try {
      const classificationPrompt: ChatMessage[] = [
        {
          role: "system",
          content: `Eres un clasificador de consultas. Responde SOLO con "rag" o "edit".
- "rag": el usuario pregunta sobre contenido, información, o busca datos en los materiales del curso.
- "edit": el usuario pide modificar, añadir, eliminar o reorganizar la estructura del árbol de conceptos.`,
        },
        {
          role: "user",
          content: `Clasifica esta consulta: "${query}"`,
        },
      ];

      const response = await this.llm.chatJSON<{ type: "rag" | "edit" }>(
        classificationPrompt
      );
      return response?.type === "rag" ? "rag" : "edit";
    } catch {
      // Default to edit on classification failure
      return "edit";
    }
  }

  /**
   * Query materials using RAG to answer information lookup questions.
   * Returns a natural language answer based on relevant chunks from course materials.
   */
  async queryMaterialsRAG(params: {
    query: string;
    materialIds: string[];
  }): Promise<string> {
    if (!this.ragEngine) {
      return "No puedo buscar en los materiales en este momento.";
    }

    try {
      // Search all materials and collect relevant chunks
      const allChunks = [];
      for (const materialId of params.materialIds) {
        const chunks = await this.ragEngine.searchRelevant(
          params.query,
          materialId,
          3 // top 3 per material
        );
        allChunks.push(...chunks);
      }

      // Sort by score and take top 5 overall
      allChunks.sort((a, b) => b.score - a.score);
      const topChunks = allChunks.slice(0, 5);

      if (topChunks.length === 0) {
        return "No he encontrado información relevante en los materiales sobre esa pregunta.";
      }

      // Build context from chunks
      const context = topChunks
        .map((chunk, i) => `[Fragmento ${i + 1}]\n${chunk.content}`)
        .join("\n\n");

      // Ask LLM to synthesize answer from context
      const messages: ChatMessage[] = [
        {
          role: "system",
          content: `Eres un asistente que responde preguntas basándote ÚNICAMENTE en el contexto proporcionado.
Si la información no está en el contexto, di que no la tienes.
Responde de forma clara y concisa en español.`,
        },
        {
          role: "user",
          content: `Contexto:\n${context}\n\nPregunta: ${params.query}`,
        },
      ];

      const response = await this.llm.chatJSON<{ answer: string }>(messages);
      return response?.answer || "No he podido procesar la respuesta.";
    } catch (error) {
      console.error("[AgentService] RAG query failed:", error);
      return "Ha ocurrido un error al buscar en los materiales.";
    }
  }

  /** Keep only well-formed actions that reference real nodes in the tree. */
  private validateActions(raw: unknown, tree: TopicNode[]): AgentAction[] {
    if (!Array.isArray(raw)) return [];
    const ids = new Set(tree.map((n) => n.id));
    const out: AgentAction[] = [];

    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const a = item as Record<string, unknown>;
      const type = a.type;
      if (typeof type !== "string" || !VALID_TYPES.has(type)) continue;

      switch (type) {
        case "addLeaf": {
          const name = typeof a.name === "string" ? a.name.trim() : "";
          if (!name) continue;
          const parentId =
            typeof a.parentId === "string" && ids.has(a.parentId)
              ? a.parentId
              : null; // unknown/absent parent → root
          out.push({
            type: "addLeaf",
            parentId,
            name,
            summary: typeof a.summary === "string" ? a.summary : undefined,
          });
          break;
        }
        case "deleteNode": {
          if (typeof a.nodeId === "string" && ids.has(a.nodeId)) {
            out.push({ type: "deleteNode", nodeId: a.nodeId });
          }
          break;
        }
        case "mergeNodes": {
          const parentId = a.parentId;
          const childIds = a.childIds;
          const name = typeof a.name === "string" ? a.name.trim() : "";
          if (
            typeof parentId === "string" &&
            ids.has(parentId) &&
            Array.isArray(childIds) &&
            childIds.length >= 2 &&
            childIds.every((c) => typeof c === "string" && ids.has(c)) &&
            name
          ) {
            out.push({
              type: "mergeNodes",
              parentId,
              childIds: childIds as string[],
              name,
            });
          }
          break;
        }
        case "renameNode": {
          if (typeof a.nodeId !== "string" || !ids.has(a.nodeId)) break;
          const name = typeof a.name === "string" ? a.name.trim() : undefined;
          const summary =
            typeof a.summary === "string" ? a.summary : undefined;
          if (!name && summary === undefined) break;
          out.push({ type: "renameNode", nodeId: a.nodeId, name, summary });
          break;
        }
        case "splitNode": {
          if (typeof a.nodeId === "string" && ids.has(a.nodeId)) {
            out.push({ type: "splitNode", nodeId: a.nodeId });
          }
          break;
        }
      }
    }
    return out;
  }
}

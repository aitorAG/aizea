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
  constructor(private readonly llm: ILLMProvider) {}

  /**
   * Run one agent turn. Returns the reply and the (validated) actions to apply.
   * Never throws for a malformed LLM response — it degrades to a reply with no
   * actions so the chat stays usable.
   */
  async run(params: {
    tree: TopicNode[];
    history: AgentTurn[];
    slideTarget: number | null;
  }): Promise<AgentResult> {
    const { system, user } = buildTreeAgentPrompt({
      tree: params.tree,
      slideTarget: params.slideTarget,
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

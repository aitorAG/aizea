import { describe, it, expect, vi } from "vitest";
import { AgentService, type AgentTurn } from "@/lib/application/AgentService";
import type { ILLMProvider } from "@/lib/application/ports/llm-provider.port";
import type { TopicNode } from "@/lib/types/pipeline";

function node(id: string, parentId: string | null = null): TopicNode {
  return {
    id,
    courseId: "c-1",
    parentId,
    name: id,
    summary: null,
    depth: parentId ? 1 : 0,
    orderIndex: 0,
    isLeaf: true,
    version: 1,
    sourceMaterialId: null,
    pageStart: null,
    pageEnd: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeLlm(envelope: unknown): {
  llm: ILLMProvider;
  chatJSON: ReturnType<typeof vi.fn>;
} {
  const chatJSON = vi.fn().mockResolvedValue(envelope);
  const llm: ILLMProvider = {
    chatJSON: chatJSON as ILLMProvider["chatJSON"],
    chat: vi.fn(),
    name: "fake",
  };
  return { llm, chatJSON };
}

const tree: TopicNode[] = [node("root"), node("a", "root"), node("b", "root")];
const history: AgentTurn[] = [{ role: "user", content: "haz algo" }];

describe("AgentService", () => {
  it("returns the reply and validated actions from the envelope", async () => {
    const { llm } = makeLlm({
      reply: "Hecho: creé una hoja.",
      actions: [{ type: "addLeaf", parentId: "root", name: "Nueva" }],
    });
    const result = await new AgentService(llm).run({ tree, history, slideTarget: null });

    expect(result.reply).toBe("Hecho: creé una hoja.");
    expect(result.actions).toEqual([
      { type: "addLeaf", parentId: "root", name: "Nueva", summary: undefined },
    ]);
  });

  it("defaults an unknown/absent parentId to root (null) for addLeaf", async () => {
    const { llm } = makeLlm({
      reply: "ok",
      actions: [{ type: "addLeaf", parentId: "ghost", name: "X" }],
    });
    const result = await new AgentService(llm).run({ tree, history, slideTarget: null });
    expect(result.actions[0]).toMatchObject({ type: "addLeaf", parentId: null });
  });

  it("drops actions referencing node ids not in the tree", async () => {
    const { llm } = makeLlm({
      reply: "ok",
      actions: [
        { type: "deleteNode", nodeId: "ghost" },
        { type: "deleteNode", nodeId: "a" },
      ],
    });
    const result = await new AgentService(llm).run({ tree, history, slideTarget: null });
    expect(result.actions).toEqual([{ type: "deleteNode", nodeId: "a" }]);
  });

  it("requires >=2 valid children for mergeNodes", async () => {
    const { llm } = makeLlm({
      reply: "ok",
      actions: [
        { type: "mergeNodes", parentId: "root", childIds: ["a"], name: "Uno" },
        { type: "mergeNodes", parentId: "root", childIds: ["a", "b"], name: "Dos" },
      ],
    });
    const result = await new AgentService(llm).run({ tree, history, slideTarget: null });
    expect(result.actions).toEqual([
      { type: "mergeNodes", parentId: "root", childIds: ["a", "b"], name: "Dos" },
    ]);
  });

  it("drops renameNode with neither name nor summary", async () => {
    const { llm } = makeLlm({
      reply: "ok",
      actions: [
        { type: "renameNode", nodeId: "a" },
        { type: "renameNode", nodeId: "b", name: "Beta" },
      ],
    });
    const result = await new AgentService(llm).run({ tree, history, slideTarget: null });
    expect(result.actions).toEqual([
      { type: "renameNode", nodeId: "b", name: "Beta", summary: undefined },
    ]);
  });

  it("ignores unknown action types", async () => {
    const { llm } = makeLlm({
      reply: "ok",
      actions: [{ type: "nuke", nodeId: "a" }, { type: "splitNode", nodeId: "a" }],
    });
    const result = await new AgentService(llm).run({ tree, history, slideTarget: null });
    expect(result.actions).toEqual([{ type: "splitNode", nodeId: "a" }]);
  });

  it("returns no actions when the envelope has none (pure conversation)", async () => {
    const { llm } = makeLlm({ reply: "El árbol ya está bien equilibrado.", actions: [] });
    const result = await new AgentService(llm).run({ tree, history, slideTarget: 100 });
    expect(result.actions).toEqual([]);
    expect(result.reply).toContain("equilibrado");
  });

  it("degrades gracefully when the LLM throws", async () => {
    const chatJSON = vi.fn().mockRejectedValue(new Error("network"));
    const llm: ILLMProvider = {
      chatJSON: chatJSON as ILLMProvider["chatJSON"],
      chat: vi.fn(),
      name: "fake",
    };
    const result = await new AgentService(llm).run({ tree, history, slideTarget: null });
    expect(result.actions).toEqual([]);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("falls back to a default reply when reply is missing", async () => {
    const { llm } = makeLlm({ actions: [] });
    const result = await new AgentService(llm).run({ tree, history, slideTarget: null });
    expect(result.reply).toBe("Hecho.");
  });

  it("passes the conversation history to the LLM as chat turns", async () => {
    const { llm, chatJSON } = makeLlm({ reply: "ok", actions: [] });
    const multi: AgentTurn[] = [
      { role: "user", content: "hola" },
      { role: "assistant", content: "¿qué necesitas?" },
      { role: "user", content: "crea una hoja" },
    ];
    await new AgentService(llm).run({ tree, history: multi, slideTarget: null });

    const messages = chatJSON.mock.calls[0][0] as Array<{ role: string; content: string }>;
    // system + 3 history turns + the framing user message
    expect(messages[0].role).toBe("system");
    expect(messages.some((m) => m.content === "¿qué necesitas?")).toBe(true);
    expect(messages.filter((m) => m.role === "user").length).toBeGreaterThanOrEqual(2);
  });
});

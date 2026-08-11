"use client";

// TreeAgentChat (v1.0) — conversational panel that edits the topic tree.
//
// The user types in natural language; each turn is sent to `treeAgentChatAction`
// which runs the LLM agent, applies the actions through TreeService, and returns
// the FRESH tree. We lift that tree to the parent via `onTreeUpdated` so the
// TreeViewer re-renders live (setNodes) with NO page reload.

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Bot, Send, User } from "lucide-react";
import { treeAgentChatAction } from "@/lib/actions/agent";
import type { AgentTurn } from "@/lib/application/AgentService";
import type { TopicNode } from "@/lib/types/pipeline";
import { cn } from "@/lib/utils";

interface TreeAgentChatProps {
  courseId: string;
  /** Called with the fresh tree after the agent applies changes. */
  onTreeUpdated: (tree: TopicNode[]) => void;
}

interface ChatMessage extends AgentTurn {
  /** Footnote shown under an assistant message, e.g. "2 cambios aplicados". */
  note?: string;
}

export function TreeAgentChat({ courseId, onTreeUpdated }: TreeAgentChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;

    setError(null);
    const userMsg: ChatMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setBusy(true);

    // History sent to the agent is the plain {role, content} turns.
    const history: AgentTurn[] = nextMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const result = await treeAgentChatAction(courseId, history);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const note =
        result.appliedCount > 0
          ? `${result.appliedCount} cambio${result.appliedCount !== 1 ? "s" : ""} aplicado${result.appliedCount !== 1 ? "s" : ""}`
          : undefined;
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.reply, note },
      ]);
      // Live-update the tree (setNodes in the parent) — no page reload.
      if (result.appliedCount > 0) onTreeUpdated(result.tree);
      // Scroll to the newest message on the next paint.
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    } catch {
      setError("No se pudo contactar con el agente. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }, [input, busy, messages, courseId, onTreeUpdated]);

  return (
    <div
      className="flex h-full flex-col rounded-lg border border-border bg-card"
      data-testid="tree-agent-chat"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">Asistente del árbol</span>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Pídeme cambios en el árbol: “crea una hoja Termodinámica bajo Física”,
            “elimina el nodo X”, “fusiona A y B en Ondas”…
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "flex gap-2 text-sm",
              m.role === "user" ? "justify-end" : "justify-start"
            )}
          >
            {m.role === "assistant" && (
              <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            )}
            <div
              className={cn(
                "max-w-[80%] rounded-md px-3 py-2",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-foreground"
              )}
            >
              <p className="whitespace-pre-wrap">{m.content}</p>
              {m.note && (
                <p className="mt-1 text-[10px] uppercase tracking-wide opacity-70">
                  {m.note}
                </p>
              )}
            </div>
            {m.role === "user" && (
              <User className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}
        {busy && (
          <p className="text-xs text-muted-foreground" data-testid="agent-busy">
            Pensando…
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="border-t border-border p-2">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder="Escribe una instrucción…"
            className="flex-1 resize-none"
            disabled={busy}
            data-testid="agent-input"
          />
          <Button
            onClick={() => void send()}
            disabled={busy || input.trim().length === 0}
            size="default"
            aria-label="Enviar"
            data-testid="agent-send"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

"use server";

// Server action for the conversational tree-editing agent (v1.0).
//
// Flow: run the AgentService (LLM → { reply, actions }), execute each action
// through the SAME TreeService the manual editor uses (single source of truth,
// same validation, keeps orderIndex/DFS coherent), prune slides orphaned by the
// mutations, then return the FRESH tree so the client applies it live with
// `setNodes` (no page reload). The reply is shown in the chat panel.
//
// No SSE in v1.0: the turn returns complete and the tree updates in one shot.

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { TreeService } from "@/lib/application/TreeService";
import { AgentService, type AgentTurn } from "@/lib/application/AgentService";
import { OpenRouterLLMProvider } from "@/lib/infrastructure/ai/openrouter-llm.provider";
import type { TopicNode } from "@/lib/types/pipeline";

const treeService = new TreeService();
const agentService = new AgentService(new OpenRouterLLMProvider());

export type TreeAgentResult =
  | {
      ok: true;
      reply: string;
      tree: TopicNode[];
      /** How many actions were actually applied (for the chat footnote). */
      appliedCount: number;
    }
  | { ok: false; error: string };

/**
 * Handle one chat turn. `history` is the full conversation INCLUDING the latest
 * user message (last item). Returns the agent reply and the updated tree.
 */
export async function treeAgentChatAction(
  courseId: string,
  history: AgentTurn[]
): Promise<TreeAgentResult> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { id: true, slideTarget: true },
  });
  if (!course) return { ok: false, error: "Curso no encontrado." };

  const treeRead = await treeService.getCourseTree(courseId);
  if (!treeRead.ok) return { ok: false, error: "No se pudo leer el árbol." };

  // 1. Ask the agent for a reply + actions.
  const { reply, actions } = await agentService.run({
    tree: treeRead.tree,
    history,
    slideTarget: course.slideTarget ?? null,
  });

  // 2. Execute each action through TreeService (same path as manual edits).
  let applied = 0;
  for (const action of actions) {
    try {
      switch (action.type) {
        case "addLeaf":
          await treeService.addTreeNode(courseId, action.parentId, {
            name: action.name,
            summary: action.summary ?? null,
          });
          applied++;
          break;
        case "deleteNode":
          await treeService.deleteTreeNode(action.nodeId);
          applied++;
          break;
        case "mergeNodes":
          await treeService.mergeTreeNodes(
            action.parentId,
            action.childIds,
            action.name
          );
          applied++;
          break;
        case "renameNode":
          await treeService.updateTreeNode(action.nodeId, {
            name: action.name,
            summary: action.summary ?? undefined,
          });
          applied++;
          break;
        case "splitNode":
          await treeService.splitTreeNode(action.nodeId);
          applied++;
          break;
      }
    } catch (err) {
      // One failing action must not abort the rest; log and continue.
      console.warn(
        "[treeAgentChatAction] action failed:",
        action.type,
        err instanceof Error ? err.message : err
      );
    }
  }

  // 3. Prune slides orphaned by the mutations: any slide whose sourceNodeId no
  //    longer exists in the (fresh) tree is stale. This keeps slides consistent
  //    with the edited tree without destroying slides for surviving concepts.
  const fresh = await treeService.getCourseTree(courseId);
  const freshTree = fresh.ok ? fresh.tree : treeRead.tree;
  if (applied > 0) {
    const liveNodeIds = new Set(freshTree.map((n) => n.id));
    const slides = await db.slide.findMany({
      where: { courseId, sourceNodeId: { not: null } },
      select: { id: true, sourceNodeId: true },
    });
    const orphanIds = slides
      .filter((s) => s.sourceNodeId != null && !liveNodeIds.has(s.sourceNodeId))
      .map((s) => s.id);
    if (orphanIds.length > 0) {
      await db.slide.deleteMany({ where: { id: { in: orphanIds } } });
    }
    revalidatePath(`/courses/${courseId}/tree`);
    revalidatePath(`/courses/${courseId}/slides`);
  }

  return { ok: true, reply, tree: freshTree, appliedCount: applied };
}

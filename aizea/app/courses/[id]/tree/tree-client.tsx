"use client";

// TreePageClient — the interactive part of /courses/[id]/tree.
//
// Responsibilities:
//  - Hold the current TopicNode[] (loaded by the server component) and
//    propagate edits from the TreeViewer up via `onTreeChange`.
//  - Render the TreeViewer.
//  - Render the PipelineProgress when an active job is supplied (the
//    page passes jobId/phase from the server).
//  - Wire the "Generar slides desde selección" button to the slide
//    server actions, so the user can ship the tree straight to the
//    slide pipeline.
//
// F4.3 — also wires the toolbar "Generar todas las diapositivas"
// button to the same slide-creation path, but with the FULL set of
// node ids (ignoring the checkbox selection). The existing
// `handleGenerate` is refactored to take an explicit `ids` argument
// so both the per-selection path (driven by the page header button)
// and the bulk path (driven by the toolbar button) share the same
// slide-creation code.
//
// F4.4 — wires the "Añadir raíz" / "Añadir hijo" toolbar buttons to
// the `addTreeNodeAction` server action. The user is taken straight
// into an inline-edit form on the new box (see
// components/TreeViewer/InlineTreeNodeEditor.tsx) so they can define
// the box's high-level content immediately. The parent tracks the
// set of "recently added" ids and passes it to the TreeViewer, which
// marks only those nodes as `isNew`. After the user saves the
// inline editor, the parent removes the id from the set — the node
// reverts to the read-only view. A TTL (5 min) also removes the id
// in case the user just navigates away.
//
// The component is intentionally thin: any complex logic lives in the
// server actions and the TreeViewer.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, GitBranch, Sparkles, FilePlus2, Plus, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { TreeViewer } from "@/components/TreeViewer/TreeViewer";
import { TreeAgentChat } from "@/components/TreeViewer/TreeAgentChat";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTranslations } from "@/components/LocaleProvider";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/toast";
import { useTreeAdapter } from "@/lib/adapters/useTreeAdapter";
import { usePipelineStore } from "@/lib/stores/usePipelineStore";
import { startPipelineAction } from "@/lib/actions/pipeline";
import { testConnectionAction } from "@/lib/actions/settings";
import { updateSlideTarget, updateLlmContext } from "@/lib/actions/course";
import { createMinimalSlides } from "@/lib/actions/slide";
import { createSlide } from "@/lib/actions/slide";
import { regenerateHtmlDesign } from "@/lib/actions/generate";
import {
  addTreeNodeAction,
  updateTreeNodeAction,
  expandTreeDepthAction,
  expandSelectedNodesDepthAction,
  type AddTreeNodeInput,
  type UpdateTreeNodeInput,
} from "@/lib/actions/tree";
import type { PipelinePhase, TopicNode } from "@/lib/types/pipeline";

interface TreePageClientProps {
  courseId: string;
  courseName: string;
  initialNodes: TopicNode[];
  /** v1.0 — target slide count (0-300) or null. Orients tree granularity. */
  initialSlideTarget?: number | null;
  /** User-provided context for LLM operations (extraction, integration, tree-building). */
  initialLlmContext?: string | null;
  activeJobId?: string | null;
  activeJobPhase?: PipelinePhase | null;
}

// F4.4 — how long a node stays in the "recently added" set after
// creation. After this TTL the inline-edit form disappears even if
// the user never typed anything. 5 min is long enough for a focused
// authoring burst but short enough that the form doesn't linger
// after the user walks away.
const RECENTLY_ADDED_TTL_MS = 5 * 60 * 1000;

// F4.4 — the placeholder name we give a newly-created box so the
// inline-edit field has a sensible starting value. The user is
// expected to replace it as soon as they start typing.

export function TreePageClient({
  courseId,
  courseName,
  initialNodes,
  initialSlideTarget = null,
  initialLlmContext = null,
  activeJobId = null,
  activeJobPhase = null,
}: TreePageClientProps) {
  const t = useTranslations();
  const [nodes, setNodes] = useState<TopicNode[]>(initialNodes);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preflightChecking, setPreflightChecking] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // v1.0 — target slide count slider (0-300). Default 50 when unset (the
  // middle orientation). Persisted on change so the pipeline/agent can read it.
  const [slideTarget, setSlideTarget] = useState<number>(initialSlideTarget ?? 50);
  // User-provided context for LLM operations. Persisted on blur.
  const [llmContext, setLlmContext] = useState<string>(initialLlmContext ?? "");
  // v1.0 — the tree agent chat panel toggle. When the agent applies changes it
  // returns the fresh tree, which we push straight into `setNodes` (live).
  const [chatOpen, setChatOpen] = useState(false);
  // v1.9 / Issue 3+4 — dedicated flag for the "Generar diapositivas"
  // toolbar action. The previous design re-used `generating` here,
  // but `generating` also gates the per-selection "Generar N
  // diapositivas" header button (which has its own slow LLM path
  // and now lives behind a separate handler). A separate flag lets
  // the user tell the two operations apart and lets the toolbar
  // button be disabled by exactly the operation that owns it.
  const [generatingSlidesOnly, setGeneratingSlidesOnly] = useState(false);
  const [startingPipeline, setStartingPipeline] = useState(false);
  // v1.8 / Issue 2.1 — `generatingTree` is flipped to `true` the
  // instant the user clicks "Generar árbol", BEFORE the await on
  // `startPipelineAction`. The previous design only set
  // `startingPipeline` inside the click handler, but the global
  // pipeline banner is only mounted after the action returns and
  // registers jobs in the store — for a fast pipeline (or any
  // pipeline whose await takes more than a couple of seconds) the
  // user saw zero feedback. The local loading banner driven by this
  // flag mounts synchronously and fills that gap.
  const [generatingTree, setGeneratingTree] = useState(false);
  const [addingNode, setAddingNode] = useState(false);
  // v1.5 / Task 3.2 — fullscreen mode. When `true`, the page-level
  // header (course name + "Árbol conceptual" title) and the
  // CheckpointBar are hidden so the tree + the in-page toolbar get
  // the entire viewport. Toggled by the Maximize2 / Minimize2 button
  // inside TreeControls. The state is mirrored to a body data
  // attribute so globals.css can hide the CheckpointBar (which
  // lives in the parent layout, not in this React tree) without
  // needing a context.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const handleToggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);
  // RA1 — ghost placeholders during expansion. IDs of leaf nodes
  // currently being expanded (one ghost child per leaf). Passed to
  // TreeViewer which injects phantom nodes under each leaf so the
  // user sees that children are being generated before the server
  // action returns.
  const [expandingLeafIds, setExpandingLeafIds] = useState<string[]>([]);
  // Mirror the fullscreen flag to a body data attribute so the
  // CSS rule in globals.css can hide the CheckpointBar (and any
  // other layout-level element we decide to suppress) without
  // mounting a context. Cleanup on unmount restores the default
  // attribute so navigating away from the tree page does not
  // leave the bar hidden.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isFullscreen) {
      document.body.setAttribute("data-tree-fullscreen", "true");
    } else {
      document.body.removeAttribute("data-tree-fullscreen");
    }
    return () => {
      if (typeof document !== "undefined") {
        document.body.removeAttribute("data-tree-fullscreen");
      }
    };
  }, [isFullscreen]);
  // v1.8 / Issue 2.3 — Escape exits fullscreen. The TreeViewer's
  // own Escape handler only clears the checkbox selection, so the
  // user had no keyboard way out of fullscreen mode. The handler
  // is a no-op when fullscreen is already off, so it costs nothing
  // on pages where the user never enters fullscreen.
  useEffect(() => {
    if (!isFullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isFullscreen]);
  // F4.4 — the set of node ids the user has just created. While
  // the id is in the set the TreeNode renders the inline-edit
  // form. The set is automatically pruned by a TTL effect below.
  // We use a Map<id, addedAtTimestamp> so we can both test
  // membership AND know when to expire.
  const [recentlyAdded, setRecentlyAdded] = useState<
    Map<string, number>
  >(() => new Map());
  const recentlyAddedRef = useRef(recentlyAdded);
  recentlyAddedRef.current = recentlyAdded;
  const { toast } = useToast();
  // v1.5 / Task 2.4 — `router.refresh()` is the only way to ask
  // the server component (page.tsx) to re-run and re-fetch the
  // TopicNode[] for this course. Without it the local `nodes`
  // state stays stale until the user manually reloads, even when
  // the pipeline banner reports "Árbol conceptual listo" on the
  // server side.
  const router = useRouter();

  const adapter = useTreeAdapter(nodes);
  const addJob = usePipelineStore((s) => s.addJob);

  // F4.4 — predicate the TreeViewer uses to decide which nodes
  // should render the inline-edit form. Reads the latest value of
  // `recentlyAdded` via the ref so the function identity is stable
  // (and the adapter memo doesn't churn).
  const isNewNode = useCallback(
    (id: string) => recentlyAddedRef.current.has(id),
    []
  );

  // F4.4 — periodically prune the recently-added set so the
  // inline-edit form disappears after the TTL even if the user
  // never typed anything. The effect runs every 30s and only
  // triggers a state update when something actually expired (we
  // compare sizes before/after). On unmount the interval is
  // cleared.
  useEffect(() => {
    const interval = setInterval(() => {
      setRecentlyAdded((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [id, addedAt] of prev) {
          if (now - addedAt > RECENTLY_ADDED_TTL_MS) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // When the page receives an activeJobId from the server, register
  // it in the store. The GlobalPipelineBanner (mounted in
  // app/layout.tsx) takes over polling from there — its own
  // `listActiveJobsAction` rehydrates any in-flight jobs on mount,
  // so we also re-register this server-provided job to keep the
  // local view in sync.
  useEffect(() => {
    if (!activeJobId || !activeJobPhase) {
      return;
    }
    addJob({
      jobId: activeJobId,
      courseId,
      courseName,
      phase: activeJobPhase,
    });
  }, [activeJobId, activeJobPhase, addJob, courseId, courseName]);

  // v1.5 / Task 2.4 — when a pipeline job for THIS course reaches
  // a terminal state (completed or failed) the orchestrator has
  // either written the new TopicNode rows (success) or rolled back
  // (failure). Either way the server component now holds data
  // that is fresher than the `nodes` we have in memory, so we
  // ask it to re-render. The sync effect below then propagates
  // the new `initialNodes` into the TreeViewer.
  //
  // We track which terminal-state transitions we've already seen
  // via a ref so a single completion only triggers ONE refresh
  // (otherwise the banner's own poll loop would re-enter the
  // effect on every tick and we'd hammer the server with
  // re-renders).
  const pipelineRefreshedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const unsubscribe = usePipelineStore.subscribe((state) => {
      for (const [jobId, job] of state.jobs) {
        if (job.courseId !== courseId) continue;
        if (!job.isComplete && !job.hasFailed) continue;
        if (pipelineRefreshedRef.current.has(jobId)) continue;
        pipelineRefreshedRef.current.add(jobId);
        // Fire-and-forget. router.refresh() returns void; React
        // batches the re-render once the server component
        // re-runs and the new props arrive.
        router.refresh();
      }
    });
    return unsubscribe;
  }, [courseId, router]);

  // v1.5 / Task 2.4 — `useState(initialNodes)` only honours the
  // prop on the first render. After a `router.refresh()` the
  // server component re-runs and the page re-passes the (now
  // non-empty) `initialNodes` down, but the local `nodes`
  // variable would otherwise stay stale until the user reloaded.
  // This effect is the bridge: it replaces the local list with
  // the fresh server list, while preserving any node the user
  // just created locally (it lives in `recentlyAdded` and the
  // server has not seen it yet).
  useEffect(() => {
    setNodes((current) => {
      if (current.length === 0) return initialNodes;
      if (initialNodes.length === 0) return initialNodes;
      // Same set of ids (regardless of order) ⇒ no diff. Skip
      // the assignment so we don't churn the TreeViewer's memo
      // and reset the user's local edits (e.g. an in-flight
      // drag on a node that hasn't round-tripped yet).
      const currentIds = new Set(current.map((n) => n.id));
      const serverById = new Map(initialNodes.map((n) => [n.id, n]));

      // v0.11.0 — the server is authoritative for STRUCTURAL fields
      // (numericPath, displayOrder, depth, parentId). After a mutation
      // (add / delete / merge / split / expand) the service recomputes
      // numbering, so on the next router.refresh() we must ADOPT those
      // fresh values onto nodes we already hold — otherwise the tree keeps
      // showing stale (or missing) numbers. We still preserve locally-added
      // nodes the server hasn't seen yet (they live in `recentlyAdded`).
      const reconciled = current.map((local) => {
        const server = serverById.get(local.id);
        if (!server) return local; // local-only node (freshly created)
        if (
          server.numericPath === local.numericPath &&
          server.displayOrder === local.displayOrder &&
          server.depth === local.depth &&
          server.parentId === local.parentId
        ) {
          return local; // no structural drift
        }
        return {
          ...local,
          numericPath: server.numericPath,
          displayOrder: server.displayOrder,
          depth: server.depth,
          parentId: server.parentId,
          orderIndex: server.orderIndex,
        };
      });

      // Append server rows the client doesn't have yet (e.g. a freshly
      // completed pipeline or an expansion round-trip).
      const merged = [...reconciled];
      for (const node of initialNodes) {
        if (!currentIds.has(node.id)) {
          merged.push(node);
        }
      }
      return merged;
    });
  }, [initialNodes]);

  const handleTreeChange = useCallback((next: TopicNode[]) => {
    setNodes(next);
  }, []);

  // F6.B — keep the local `nodes` list in sync with the server-side
  // mutations the TreeViewer just performed (Prune / Delete / Merge /
  // Split). Without this callback the tree visually shows the
  // deleted/merged/split node until the user reloads, because the
  // TreeViewer only owns the pending UI state — the actual node
  // array lives here. AddChild / AddRoot already flow through
  // `handleAddRequest` (see below) and refresh this list directly.
  const handleNodesChanged = useCallback(
    (
      deletedIds?: string[],
      addedNode?: TopicNode,
      updatedNode?: TopicNode
    ) => {
      setNodes((prev) => {
        let next = prev;
        if (deletedIds && deletedIds.length > 0) {
          next = next.filter((n) => !deletedIds.includes(n.id));
        }
        if (addedNode) {
          // Avoid duplicating if the parent already has it (e.g. on
          // a stale callback from a previous render).
          if (!next.some((n) => n.id === addedNode.id)) {
            next = [...next, addedNode];
          }
        }
        if (updatedNode) {
          next = next.map((n) => (n.id === updatedNode.id ? updatedNode : n));
        }
        return next;
      });
      // v0.11.0 — a structural mutation (delete / merge / split) recomputed
      // numbering server-side. Refresh so the server component re-runs and the
      // reconciliation effect adopts the fresh numericPath onto surviving
      // nodes (otherwise the tree shows stale/missing numbers until reload).
      router.refresh();
    },
    [router]
  );

  const handleSelection = useCallback(
    (ids: string[]) => {
      setSelectedIds(ids);
    },
    []
  );

  // F4.4 — `handleAddRoot` / `handleAddChild`. Wired to the
  // TreeViewer's `onAddRequest` callback. The TreeViewer calls
  // this when the user clicks the toolbar's "Añadir raíz" or
  // "Añadir hijo" button. We call the server action, push the
  // returned node into the local state, and mark it as recently
  // added so the inline-edit form appears.
  const handleAddRequest = useCallback(
    async (kind: "child" | "root", parentId?: string) => {
      if (addingNode) return;
      setAddingNode(true);
      try {
        const data: AddTreeNodeInput = {
          name: t("tree.newNode"),
          summary: null,
        };
        const result =
          kind === "root"
            ? await addTreeNodeAction(courseId, null, data)
            : await addTreeNodeAction(courseId, parentId ?? null, data);
        if (!result.ok) {
          console.error("[tree] add node failed:", result.error);
          toast({
            title: t("tree.errors.addNode"),
            description: t("tree.errors.addNodeDescription"),
            variant: "error",
          });
          return;
        }
        const created = result.node;
        // Push the new node into the local list so the TreeViewer
        // re-renders with it. We also mark it as recently added
        // so the inline-edit form appears immediately on the new
        // box.
        setNodes((prev) => [...prev, created]);
        setRecentlyAdded((prev) => {
          const next = new Map(prev);
          next.set(created.id, Date.now());
          return next;
        });
        toast({
          title: kind === "root" ? t("tree.added.root") : t("tree.added.child"),
          description:
            t("tree.added.description"),
          variant: "success",
        });
        // v0.11.0 — adding a node recomputed numbering server-side; refresh so
        // the reconciliation effect adopts the fresh numericPath. The inline
        // name/summary edit is preserved (reconciliation only adopts structural
        // fields, and `recentlyAdded` state survives the refresh).
        router.refresh();
      } catch (err) {
        console.error("[tree] add node threw:", err);
        toast({
          title: t("tree.errors.addNode"),
          description: t("tree.errors.addNodeDescription"),
          variant: "error",
        });
      } finally {
        setAddingNode(false);
      }
    },
    [addingNode, courseId, toast, router, t]
  );

  // F4.4 — the inline-edit save handler. Called by the TreeNode
  // when the user presses Enter or blurs the description field.
  // We call the server action and update the local node in place;
  // the inline-edit form stays mounted until the TTL expires (or
  // until the user explicitly removes the node from the set — see
  // `clearRecentlyAdded` for that path).
  const handleSaveInlineEdit = useCallback(
    async (
      nodeId: string,
      values: { name: string; summary: string | null }
    ): Promise<void> => {
      const update: UpdateTreeNodeInput = {
        name: values.name,
        summary: values.summary,
      };
      const result = await updateTreeNodeAction(nodeId, update);
      if (!result.ok) {
        console.error("[tree] inline node update failed:", result.error);
        toast({
          title: t("tree.errors.save"),
          description: t("common.unknownError"),
          variant: "error",
        });
        // Re-throw so the InlineTreeNodeEditor can show its own
        // error indicator and keep the editor open.
        throw new Error(t("common.unknownError"));
      }
      // Update the local node with the server-confirmed values
      // (so version bumps are reflected) and clear the "recently
      // added" flag for this id — the user has finished the
      // bootstrap and the editor should now disappear in favour
      // of the read-only view.
      setNodes((prev) =>
        prev.map((n) => (n.id === nodeId ? result.node : n))
      );
      setRecentlyAdded((prev) => {
        if (!prev.has(nodeId)) return prev;
        const next = new Map(prev);
        next.delete(nodeId);
        return next;
      });
    },
    [toast, t]
  );

  // F4.3 — refactored to take an explicit `ids` argument so both
  // the per-selection "Generar N" header button and the toolbar
  // "Generar todas" button can reuse the same slide-creation loop
  // without going through the (UI-only) selectedIds state. This is
  // the single point of truth for "create one slide per node id".
  //
  // v1.8 / Issue 3.3 — after creating each slide we now also
  // call `regenerateHtmlDesign` so the slide lands with both
  // content boxes AND the HTML visualization already filled in.
  // Previously the button only created the slide row (title +
  // description), leaving the user with an empty `htmlDesign`
  // column that they had to click into each slide to fill. Empty
  // design instructions ("") is the right call here: the prompt
  // is designed to produce a clean, professional layout when no
  // user direction is supplied.
  //
  // We isolate the HTML call in its own try/catch so a single
  // slide failing its HTML pass doesn't undo the slide creation
  // or block the rest of the batch. The user can always run
  // "Generar todo" from the slides list to retry the HTML step.
  const handleGenerate = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      setGenerating(true);
      try {
        const created: { id: string; title: string }[] = [];
        for (const id of ids) {
          const node = nodes.find((n) => n.id === id);
          if (!node) continue;
          const slide = await createSlide(
            courseId,
            node.name,
            node.summary ?? ""
          );
          created.push({ id: slide.id, title: slide.title });
          // v1.8 / Issue 3.3 — kick off HTML generation in the
          // same loop so the slide lands with both content + HTML.
          // Best-effort: a failure here does NOT roll back the
          // slide row, the user can retry from the slides list.
          try {
            await regenerateHtmlDesign(slide.id, "");
          } catch {
            // Swallow — the slide row is already persisted, and
            // the next page will surface the missing HTML via
            // the empty-state on the slide thumbnail.
          }
        }
        toast({
          title: t("tree.slides.generated"),
          description: t(created.length === 1 ? "tree.slides.generatedOne" : "tree.slides.generatedMany", { count: created.length }),
          variant: "success",
        });
      } catch (err) {
        console.error("[tree] slide generation failed:", err);
        toast({
          title: t("tree.errors.generate"),
          description:
            t("tree.errors.generateSlidesDescription"),
          variant: "error",
        });
      } finally {
        setGenerating(false);
      }
    },
    [courseId, nodes, toast, t]
  );

  // F4.3 — one-click bulk action. Calls handleGenerate with the
  // full set of node ids, ignoring the checkbox selection. Wired
  // to the toolbar button so the user can generate slides for the
  // whole tree without having to "Seleccionar todas" first.
  const handleGenerateAll = useCallback(() => {
    return handleGenerate(nodes.map((n) => n.id));
  }, [handleGenerate, nodes]);

  // v1.9 / Issue 3+4 — the "Generar diapositivas" toolbar button
  // is now wired to a DEDICATED handler that does three things the
  // old `handleGenerateAll` did NOT:
  //   1. Show a synchronous "Generando N diapositivas..." toast
  //      BEFORE the await on the server action, so the user has
  //      feedback even if the action is slow.
  //   2. Call `createMinimalSlides` (the new server action) which
  //      only creates the slide skeleton — no LLM call, no
  //      htmlDesign, no SlideBox rows. The previous handler also
  //      called `regenerateHtmlDesign` per slide, which populated
  //      `htmlDesign` and was the root cause of Issue 4 (slides
  //      arriving with content the user wanted to author
  //      themselves).
  //   3. Navigate the user to the slides page on success, so the
  //      next click is always one step closer to the result. The
  //      success toast is shown AFTER navigation so the toast
  //      survives the page transition.
  //
  // The handler is intentionally separate from `handleGenerateAll`
  // because the two actions have different product intents:
  //   - `handleGenerateAll` is the v1.5 "outline" path (the header
  //     button): create slides AND kick off content generation.
  //   - `handleGenerateSlidesOnly` is the v1.9 "skeleton" path
  //     (the toolbar button): create slides and let the user
  //     author content from the slides page.
  const handleGenerateSlidesOnly = useCallback(async () => {
    if (nodes.length === 0) return;
    const ids = nodes.map((n) => n.id);
    setGeneratingSlidesOnly(true);
    // Show feedback BEFORE the await. The toast system is
    // synchronous (zustand store), so the user sees the toast
    // even when the action is in flight.
    toast({
      title: t(ids.length === 1 ? "tree.slides.generatingOne" : "tree.slides.generatingMany", { count: ids.length }),
      description: t("tree.slides.creatingOutline"),
      variant: "info",
    });
    try {
      const created = await createMinimalSlides(courseId, ids);
      // Issue 3 — navigate the user to the slides page as soon as
      // the skeleton is persisted. The user expects "Generar
      // diapositivas" to take them to the slides list; the
      // success toast is appended so the post-navigation page
      // also shows feedback.
      router.push(`/courses/${courseId}/slides`);
      toast({
        title: t("tree.slides.created"),
        description: t(created.length === 1 ? "tree.slides.createdOne" : "tree.slides.createdMany", { count: created.length }),
        variant: "success",
      });
      } catch (err) {
        console.error("[tree] slide creation failed:", err);
      toast({
        title: t("tree.errors.generateSlides"),
          description: t("tree.errors.generateSlidesDescription"),
        variant: "error",
      });
    } finally {
      setGeneratingSlidesOnly(false);
    }
  }, [courseId, nodes, router, toast, t]);

  // Handler para expandir el árbol un nivel de profundidad.
  // Genera un hijo para cada nodo hoja actual usando el LLM.
  // Si hay nodos seleccionados, expande solo esos nodos; de lo contrario, expande todos los nodos hoja.
  // RA1 — calcula las hojas objetivo y setea `expandingLeafIds` para que
  // TreeViewer inyecte nodos fantasma durante la espera.
  const handleExpandDepth = useCallback(async () => {
    if (nodes.length === 0) return;

    const selectedNodeIds = Array.from(selectedIds);
    const isSelectiveExpansion = selectedNodeIds.length > 0;

    // RA1 — calcular las hojas objetivo (seleccionadas, o las del
    // nivel más profundo si no hay selección). Una hoja es un nodo
    // sin hijos (no aparece como parentId de ningún otro nodo).
    const childrenByParent = new Map<string, string[]>();
    for (const node of nodes) {
      if (!node.parentId) continue;
      const sibs = childrenByParent.get(node.parentId) ?? [];
      sibs.push(node.id);
      childrenByParent.set(node.parentId, sibs);
    }
    const allLeaves = nodes.filter(n => !childrenByParent.has(n.id));
    const targetLeaves = isSelectiveExpansion
      ? allLeaves.filter(leaf => selectedNodeIds.includes(leaf.id))
      : allLeaves;
    const targetLeafIds = targetLeaves.map(n => n.id);

    setExpandingLeafIds(targetLeafIds);
    setGenerating(true);
    toast({
      title: t("tree.expanding"),
      description: isSelectiveExpansion
        ? t(selectedNodeIds.length === 1 ? "tree.expand.selectedOne" : "tree.expand.selectedMany", { count: selectedNodeIds.length })
        : t("tree.expand.description"),
      variant: "info",
    });
    try {
      const result = isSelectiveExpansion
        ? await expandSelectedNodesDepthAction(courseId, selectedNodeIds)
        : await expandTreeDepthAction(courseId);

      if (!result.ok) {
        console.error("[tree] depth expansion failed:", result.error);
        toast({
          title: t("tree.errors.expand"),
          description: t("tree.errors.expandDescription"),
          variant: "error",
        });
        return;
      }
      // Actualizar los nodos locales con el árbol expandido
      setNodes(result.nodes);
      toast({
          title: t("tree.expanded"),
        description: t(result.addedCount === 1 ? "tree.expand.addedOne" : "tree.expand.addedMany", { count: result.addedCount }),
        variant: "success",
      });
      } catch (err) {
        console.error("[tree] depth expansion threw:", err);
      toast({
          title: t("tree.errors.expand"),
          description: t("tree.errors.expandDescription"),
        variant: "error",
      });
    } finally {
      setExpandingLeafIds([]);
      setGenerating(false);
    }
  }, [courseId, nodes, selectedIds, toast, t]);

  const runPreflight = useCallback(async (): Promise<boolean> => {
    // Fail early with an actionable message instead of allowing a long
    // pipeline to fail after the first LLM/docling call. This callback is
    // shared by the primary CTA and the retry action in the error panel.
    setPreflightChecking(true);
    try {
      const connection = await testConnectionAction();
      const failedChecks = [connection.openRouter, connection.docling].filter(
        (check) => !check.ok
      );
      if (failedChecks.length > 0) {
        setPreflightError(failedChecks.map((check) => check.message).join(" "));
        toast({
          title: t("tree.preflight.pending"),
          description: t("tree.preflight.description"),
          variant: "error",
        });
        return false;
      }
      setPreflightError(null);
      return true;
    } catch (err) {
      setPreflightError(
        t("tree.preflight.error")
      );
      return false;
    } finally {
      setPreflightChecking(false);
    }
  }, [toast, t]);

  const handleStartPipeline = useCallback(async () => {
    if (!(await runPreflight())) return;

    // v1.8 / Issue 2.1 — flip BOTH flags synchronously, before
    // awaiting the server action. `startingPipeline` keeps the
    // button in its loading state; `generatingTree` mounts the
    // local loading banner the user actually sees during the await.
    //
    // v1.9 / Issue 1 — the GLOBAL pipeline banner also needs to
    // appear synchronously, before the server action returns. The
    // previous design only registered jobs in the store AFTER the
    // await, so a 30s pipeline showed no global banner for 30s and
    // the user thought nothing was happening (they saw the local
    // card but not the persistent banner). We now mint a single
    // client-side `runId` at click time, register a "pending"
    // placeholder job with that runId BEFORE the await, and replace
    // it with the real phase jobs (all sharing the same runId) once
    // the action returns. The banner's `getBannerGroups` collapses
    // everything under the same runId into ONE banner, so the
    // transition from placeholder to real jobs is invisible.
    setStartingPipeline(true);
    setGeneratingTree(true);

    // Mint a fresh runId. crypto.randomUUID is available in every
    // browser we support (and the Next.js client) — it is the
    // strongest client-side correlation handle we have without
    // touching the server schema. Every job registered for this
    // pipeline run (placeholder + real phase jobs) carries this
    // runId, so the banner groups them under a single row.
    const runId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `run-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const placeholderNow = Date.now();
    // Register the placeholder synchronously so the global banner
    // mounts on the very next React render. The placeholder uses a
    // fake jobId prefixed with "pending:"; the banner's polling
    // loop will try to fetch its status, fail, and skip the update
    // (it already handles `!result.ok` gracefully). When the real
    // jobIds arrive we remove the placeholder and add the four
    // real rows — all sharing the same `runId` so the banner
    // group stays continuous.
    const placeholderJobId = `pending:${runId}`;
    usePipelineStore.getState().addJob({
      jobId: placeholderJobId,
      runId,
      courseId,
      courseName,
      phase: "segmentation",
      status: "pending",
      progress: 0,
      currentStep: t("pipeline.status.starting"),
      startedAt: placeholderNow,
    });

    try {
      // Fase 2.2 — `startPipelineAction` now ENQUEUES the run and returns
      // immediately (no longer blocks for the whole pipeline). The worker
      // creates the phase rows in the background; the banner's discovery
      // re-list effect DISCOVERS them by courseId and inherits this
      // placeholder's runId so they collapse into one banner group, then
      // drops the placeholder. So on the happy path we KEEP the placeholder
      // alive here — the banner takes over from this point.
      const result = await startPipelineAction(courseId);
      const store = usePipelineStore.getState();

      if (!result.ok) {
        console.error("[tree] pipeline start failed:", result.error);
        store.removeJob(placeholderJobId);
        toast({
          title: t("tree.errors.startPipeline"),
          description: t("tree.errors.startPipelineDescription"),
          variant: "error",
        });
        return;
      }

      // NO_MATERIALS: nothing was enqueued. Drop the placeholder and tell
      // the user to upload a PDF. (Deeper empty cases — FILE_MISSING /
      // ALL_EMPTY / ALL_FAILED — now surface in the worker via the
      // in-app notifier and the banner's failed/empty phase rows.)
      if (result.empty) {
        store.removeJob(placeholderJobId);
        toast({
          title: t("pipeline.noContent"),
          description: t("pipeline.noContent"),
          variant: "info",
        });
        return;
      }

      // Enqueued OK. Auto-refresh the server component so the tree page
      // reflects any state change; the completion effect refreshes again
      // when the banner flips to done. The placeholder stays until the
      // banner discovers the real phase rows (see discovery re-list effect
      // in GlobalPipelineBanner), which removes it and shows live progress.
      router.refresh();
      toast({
        title: t("tree.pipeline.started"),
        description: t("tree.pipeline.startedDescription"),
        variant: "success",
      });
    } catch (err) {
      console.error("[tree] pipeline start threw:", err);
      // Remove the placeholder on failure too so the banner
      // doesn't linger forever after a thrown server action.
      usePipelineStore.getState().removeJob(placeholderJobId);
      toast({
        title: t("tree.errors.startPipeline"),
        description: t("tree.errors.startPipelineDescription"),
        variant: "error",
      });
    } finally {
      setStartingPipeline(false);
      // v1.8 / Issue 2.1 — the local loading banner is replaced by
      // the global pipeline banner as soon as the action returns
      // and the four phase jobs are registered in the store. The
      // "empty" branch above (course with nothing to process) also
      // calls this from the early return via the finally block.
      //
      // v1.9 — with the synchronous placeholder registration, the
      // global banner mounts BEFORE the await returns, so the user
      // sees BOTH the local card and the global banner during the
      // first frame. We hide the local card the moment the action
      // resolves (success or failure) so the global banner becomes
      // the single source of truth. If the action rejects the
      // placeholder is removed in the catch above and the local
      // card disappears here, so the user ends up looking at a
      // clean empty state with the error toast.
      setGeneratingTree(false);
    }
  }, [courseId, courseName, router, runPreflight, toast, t]);

  const hasTree = nodes.length > 0;

  return (
    <div
      className={cn(
        "flex h-[calc(100vh-4rem)] flex-col gap-3 p-3 sm:p-4",
        // v1.5 / Task 3.2 — drop the page padding in fullscreen so
        // the tree canvas can use every pixel of the viewport.
        // v1.7 / Issue 2.1 — also force 100vw × 100vh on the wrapper
        // (the top <header> and CheckpointBar are hidden via CSS in
        // globals.css, so subtracting their height is no longer
        // necessary). The className change is mirrored by the
        // `body[data-tree-fullscreen="true"] [data-tree-fullscreen="true"]`
        // rule in globals.css — both belt-and-suspenders so the canvas
        // uses every pixel of the viewport.
        isFullscreen && "h-screen w-screen p-0 sm:p-0"
      )}
      data-tree-fullscreen={isFullscreen ? "true" : undefined}
    >
      {/* Header — hidden in fullscreen mode (v1.5 / Task 3.2) so
          the tree + in-page toolbar get the entire viewport. The
          toolbar itself stays visible because the user asked for
          the "barra superior de herramientas" to remain on screen
          in fullscreen (it IS the only navigation surface left). */}
      <div
        className={cn(
          "flex flex-wrap items-end justify-between gap-3",
          isFullscreen && "hidden"
        )}
      >
        <div className="min-w-0">
          <Link
            href={`/courses/${courseId}/materials`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {courseName}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight">
            <GitBranch className="h-6 w-6 text-primary" />
            {t("tree.title")}
          </h1>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {hasTree
              ? t(nodes.length === 1 ? "tree.summaryOne" : "tree.summaryMany", { count: nodes.length, selected: selectedIds.length })
              : t("tree.noTree")}
          </p>
        </div>

        {hasTree && selectedIds.length > 0 && (
          <Button
            onClick={() => handleGenerate(selectedIds)}
            disabled={generating}
            size="default"
            data-testid="generate-slides-button"
          >
            {generating ? (
              <Spinner size="sm" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {generating
              ? t("tree.status.generating")
              : t(selectedIds.length === 1 ? "tree.slides.generateOne" : "tree.slides.generateMany", { count: selectedIds.length })}
          </Button>
        )}
        {hasTree && (
          <Button
            onClick={() => setChatOpen((v) => !v)}
            variant={chatOpen ? "default" : "outline"}
            size="default"
            data-testid="toggle-agent-chat"
            aria-pressed={chatOpen}
          >
            <MessageSquare className="h-4 w-4" />
            {t("tree.chat.title")}
          </Button>
        )}
      </div>

      {/* v1.8 / Issue 2.1 — local loading banner. Mounts the
          instant the user clicks "Generar árbol", BEFORE the await
          on `startPipelineAction`. The previous design only
          surfaced feedback AFTER the action returned and the four
          phase jobs were registered in the store, which is a
          synchronous blind spot for fast pipelines and a multi-
          second blind spot for any real LLM call. We mount a
          full-page spinner card as soon as `generatingTree`
          flips, and hide it in the `finally` block (which the
          action's early `return` paths also flow through) so the
          global pipeline banner can take over. The card lives
          above the empty state / TreeViewer so the user always
          sees progress regardless of whether the course already
          had nodes. */}
      {generatingTree && (
        <div
          className="flex flex-1 items-center justify-center p-6"
          data-testid="generating-tree-banner"
          data-state="starting"
        >
          <div
            className={cn(
              "flex w-full max-w-md flex-col items-center gap-3 rounded-lg border border-primary/20 bg-card p-8 text-center shadow-sm",
              isFullscreen && "bg-card/95 backdrop-blur"
            )}
          >
            <Spinner size="lg" />
            <p className="text-base font-semibold text-foreground">
              {t("tree.generatingTree")}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {t("pipeline.status.starting")}
            </p>
          </div>
        </div>
      )}

      {/* Empty state — no tree yet. Offer the user two paths:
          1. Run the LLM pipeline to bootstrap from materials.
          2. Manually create the first root via the same handler the
             toolbar uses once a node exists (`handleAddRequest("root")`).
          Without the second option, a user without materials has no way
          to start a tree at all (the pipeline path is a no-op on an
          empty course). The two actions live side-by-side so the user
          can pick whichever fits their workflow. v1.8 / Issue 2.1 —
          hidden while `generatingTree` is true so the local loading
          banner is the only thing on screen during the start. */}
      {!hasTree && !generatingTree && (
        <div className="flex flex-1 items-center justify-center p-6" data-testid="empty-tree">
          <EmptyState
            icon={<GitBranch className="h-10 w-10" />}
            title={t("tree.empty.title")}
            description={t("tree.empty.bootstrapDescription")}
            action={
              <div className="flex flex-col items-center gap-4">
                {/* v1.0 — granularity slider (0-300 target slides). Orients
                    how finely the pipeline splits topics; persisted on release
                    so the pipeline and the tree agent can read it. */}
                <div className="w-full max-w-sm" data-testid="slide-target-control">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <label htmlFor="slide-target" className="font-medium text-foreground">
                      {t("tree.slideTarget.label")}
                    </label>
                    <span className="tabular-nums text-muted-foreground" data-testid="slide-target-value">
                      {slideTarget}
                    </span>
                  </div>
                  <input
                    id="slide-target"
                    type="range"
                    min={0}
                    max={300}
                    step={5}
                    value={slideTarget}
                    onChange={(e) => setSlideTarget(Number(e.target.value))}
                    onPointerUp={() => void updateSlideTarget(courseId, slideTarget)}
                    onKeyUp={() => void updateSlideTarget(courseId, slideTarget)}
                    className="w-full accent-primary"
                    data-testid="slide-target-slider"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("tree.slideTarget.hint")}
                  </p>
                </div>
                {/* User-provided context for LLM operations. Persisted on blur. */}
                <div className="w-full max-w-sm" data-testid="llm-context-control">
                  <label htmlFor="llm-context" className="mb-1 block text-sm font-medium text-foreground">
                    {t("tree.context.label")}
                  </label>
                  <Textarea
                    id="llm-context"
                    value={llmContext}
                    onChange={(e) => setLlmContext(e.target.value)}
                    onBlur={() => void updateLlmContext(courseId, llmContext || null)}
                    placeholder={t("tree.context.placeholder")}
                    className="min-h-[80px] resize-y"
                    data-testid="llm-context-textarea"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("tree.context.hint")}
                  </p>
                </div>
                 {preflightError && (
                   <div
                     className="w-full max-w-md rounded-md border border-destructive/30 bg-destructive/5 p-3 text-left text-sm"
                     role="alert"
                     data-testid="tree-preflight-error"
                   >
                     <p className="font-medium text-destructive">
                       {t("tree.preflight.cannotStart")}
                     </p>
                     <p className="mt-1 text-xs text-muted-foreground">
                       {preflightError}
                     </p>
                      <Link
                        href="/settings"
                        className="mt-2 inline-flex text-xs font-medium text-primary underline underline-offset-2"
                     >
                         {t("tree.preflight.openSettings")}
                      </Link>
                      <Button
                        onClick={() => void runPreflight()}
                        loading={preflightChecking}
                        variant="outline"
                        size="sm"
                        className="mt-3"
                        data-testid="retry-tree-preflight"
                      >
                         {t("tree.preflight.retry")}
                      </Button>
                    </div>
                  )}
                 <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button
                    onClick={handleStartPipeline}
                    loading={startingPipeline || preflightChecking}
                    size="lg"
                    data-testid="generate-tree-button"
                  >
                    <FilePlus2 className="h-4 w-4" />
                    {preflightChecking ? t("tree.preflight.checking") : t("tree.actions.generateTree")}
                  </Button>
                  <Button
                    onClick={() => handleAddRequest("root")}
                    disabled={addingNode}
                    variant="outline"
                    size="lg"
                    data-testid="empty-state-add-root"
                    aria-label={t("tree.actions.addRoot")}
                  >
                    <Plus className="h-4 w-4" />
                    {t("tree.actions.addRoot")}
                  </Button>
                </div>
              </div>
            }
          />
        </div>
      )}

      {/* v0.11.0 — while a tree pipeline job is active we still show the
          TreeViewer full-width. Pipeline PROGRESS is no longer shown here (no
          sidebar, no banner): the Jobs tab is the single source of truth for
          process visibility (R5). */}
      {hasTree && !generatingTree && activeJobId && (
        <div className={cn("flex min-h-[60vh] flex-1 overflow-hidden", isFullscreen && "min-h-0")}>
          <div
            className={cn(
              "min-h-[60vh] flex-1 overflow-hidden rounded-lg border border-border bg-card",
              isFullscreen && "min-h-0 rounded-none border-0"
            )}
          >
            <TreeViewer
              nodes={nodes}
              onChange={handleTreeChange}
              onGenerateSlides={handleSelection}
              onSelectionChange={setSelectedIds}
              // v1.9 / Issue 3+4 — the toolbar "Generar
              // diapositivas" button now invokes the dedicated
              // `handleGenerateSlidesOnly` handler (no LLM,
              // no htmlDesign, navigates to /slides on success).
              // The header button still uses `handleGenerateAll`
              // via the `onGenerateSlides` path.
              onGenerateAllSlides={handleGenerateSlidesOnly}
              onExpandDepth={handleExpandDepth}
              onAddRequest={handleAddRequest}
              isNewNode={isNewNode}
              onSaveInlineEdit={handleSaveInlineEdit}
              onNodesChanged={handleNodesChanged}
              isFullscreen={isFullscreen}
              onToggleFullscreen={handleToggleFullscreen}
              // v1.9 / Issue 3 — disable the toolbar's button
              // while the in-flight server action runs.
              // RA1.2 — also disable during expansion (generating).
              busy={generatingSlidesOnly || generating}
              // RA1 — pass expanding leaf IDs for ghost placeholders
              expandingLeafIds={expandingLeafIds}
            />
          </div>
        </div>
      )}

      {/* No active job — TreeViewer (optionally beside the agent chat) */}
      {hasTree && !generatingTree && !activeJobId && (
        <div
          className={cn(
            "flex min-h-[70vh] flex-1 gap-3 overflow-hidden",
            isFullscreen && "min-h-0"
          )}
        >
          <div
            className={cn(
              "min-h-[70vh] flex-1 overflow-hidden rounded-lg border border-border bg-card",
              isFullscreen && "min-h-0 rounded-none border-0"
            )}
          >
            <TreeViewer
              nodes={nodes}
              onChange={handleTreeChange}
              onGenerateSlides={handleSelection}
              onSelectionChange={setSelectedIds}
              // v1.9 / Issue 3+4 — same handler swap as the
              // active-job branch above. The toolbar button is the
              // entry point on every layout of the tree page.
              onGenerateAllSlides={handleGenerateSlidesOnly}
              onExpandDepth={handleExpandDepth}
              onAddRequest={handleAddRequest}
              isNewNode={isNewNode}
              onSaveInlineEdit={handleSaveInlineEdit}
              onNodesChanged={handleNodesChanged}
              isFullscreen={isFullscreen}
              onToggleFullscreen={handleToggleFullscreen}
              busy={generatingSlidesOnly || generating}
              expandingLeafIds={expandingLeafIds}
            />
          </div>
          {chatOpen && !isFullscreen && (
            <div className="hidden w-80 shrink-0 lg:block" data-testid="agent-chat-panel">
              <TreeAgentChat courseId={courseId} onTreeUpdated={setNodes} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default TreePageClient;

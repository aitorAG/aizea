import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJSON, type ChatMessage } from "@/lib/infrastructure/ai/llm-client";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { dfsPreorder } from "@/lib/domain/pipeline/tree-order";
import { RAGEngine, type RelevantChunk } from "@/lib/domain/rag/RAGEngine";
import { createRAGEngine } from "@/lib/infrastructure/rag/rag-engine.factory";
import { SlideBoxService } from "@/lib/application/SlideBoxService";
import { BoxType, type GeneratedBoxes } from "@/lib/types";
import type { TopicNode } from "@/lib/types/pipeline";

export interface LLMClientInterface {
  chatJSON: <T>(messages: ChatMessage[]) => Promise<T>;
}

/**
 * SlideGenerationService — responsabilidad ÚNICA: generación de diapositivas y
 * su contenido asistida por IA (outline pedagógico, esqueleto árbol→slides,
 * cajas de contenido con RAG, diseño HTML).
 *
 * Extraído de `SlideService` (fichero-dios con 6 responsabilidades) como parte
 * de la Fase 1 del plan de reescritura selectiva (CA-7). Agrupa las cuatro
 * responsabilidades que dependen de las colaboraciones inyectadas
 * (llmClient / promptManager / ragEngine). La persistencia de cajas se delega
 * en `SlideBoxService`.
 */
export class SlideGenerationService {
  private boxService: SlideBoxService;

  constructor(
    private llmClient: LLMClientInterface = { chatJSON },
    private promptManager: PromptManager = new PromptManager(),
    private ragEngine: RAGEngine = createRAGEngine(),
    private database: PrismaClient = db,
    boxService?: SlideBoxService
  ) {
    this.boxService = boxService ?? new SlideBoxService(database);
  }

  /**
   * Generate a slide outline from a set of selected TopicNodes. The LLM
   * only reorders the nodes in pedagogical order; one slide is created per
   * node using `node.name` as the title and `node.summary` as the
   * description. Existing slides for the course are replaced.
   *
   * @returns the list of created slides in the order returned by the LLM.
   */
  async generateOutlineFromTree(
    courseId: string,
    selectedNodeIds: string[]
  ): Promise<
    { id: string; courseId: string; title: string; description: string; order: number }[]
  > {
    if (selectedNodeIds.length === 0) {
      throw new Error("Selecciona al menos un nodo del árbol para generar diapositivas.");
    }

    const rows = await this.database.topicNode.findMany({
      where: { id: { in: selectedNodeIds }, courseId },
    });

    if (rows.length === 0) {
      throw new Error("Los nodos seleccionados no existen en este curso.");
    }

    const nodesById = new Map<string, TopicNode>();
    for (const row of rows) {
      nodesById.set(row.id, {
        id: row.id,
        courseId: row.courseId,
        parentId: row.parentId,
        name: row.name,
        summary: row.summary,
        depth: row.depth,
        orderIndex: row.orderIndex,
        isLeaf: row.isLeaf,
        version: row.version,
        sourceMaterialId: row.sourceMaterialId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    const orderedIds = await this.organizePedagogically(
      Array.from(nodesById.values())
    );

    // Fall back to the selection order if the LLM dropped or duplicated
    // an id, or didn't return a valid order at all — the result must
    // contain exactly the selected nodes.
    const finalIds = this.normalizeOrder(orderedIds, selectedNodeIds);

    await this.database.slide.deleteMany({ where: { courseId } });

    // First pass: create slides without parent links so we can resolve
    // parentSlideId in a second pass (parent may be created later in
    // the order returned by the LLM).
    const created = await this.database.$transaction(
      finalIds.map((id, idx) => {
        const node = nodesById.get(id);
        if (!node) {
          // Should never happen because normalizeOrder preserves selectedNodeIds.
          throw new Error(`Nodo no encontrado: ${id}`);
        }
        return this.database.slide.create({
          data: {
            courseId,
            title: node.name,
            description: node.summary ?? "",
            order: idx,
            sourceNodeId: node.id,
          },
        });
      })
    );

    const slideIdByNodeId = new Map<string, string>();
    created.forEach((slide, i) => {
      slideIdByNodeId.set(finalIds[i], slide.id);
    });

    // Second pass: link each slide to its parent's slide (if any) based
    // on the source TopicNode's parentId.
    const parentUpdates: { id: string; parentSlideId: string | null }[] = [];
    for (const node of nodesById.values()) {
      const slideId = slideIdByNodeId.get(node.id);
      if (!slideId) continue;
      const parentSlideId = node.parentId
        ? slideIdByNodeId.get(node.parentId) ?? null
        : null;
      if (parentSlideId !== null) {
        parentUpdates.push({ id: slideId, parentSlideId });
      }
    }

    if (parentUpdates.length > 0) {
      await this.database.$transaction(
        parentUpdates.map((u) =>
          this.database.slide.update({
            where: { id: u.id },
            data: { parentSlideId: u.parentSlideId },
          })
        )
      );
    }

    // Return the freshly-created slides with the parent links resolved.
    const final = await this.database.slide.findMany({
      where: { courseId },
      orderBy: { order: "asc" },
      select: {
        id: true,
        courseId: true,
        title: true,
        description: true,
        order: true,
      },
    });
    return final;
  }

  /**
   * v1.9 / Issue 3+4 — Create a minimal slide skeleton for each
   * supplied TopicNode, WITHOUT triggering any LLM call (no content
   * boxes, no HTML design). The user opens the slides page and
   * drives content generation from there.
   *
   * This is intentionally a sibling of `generateOutlineFromTree` and
   * NOT a refactor of it: the two paths serve different product
   * intents:
   *
   *   - `generateOutlineFromTree` is the v1.5 "outline" path: it
   *     asks the LLM to reorder the nodes and produces a
   *     "ready-to-present" slide list. It replaces any existing
   *     slides for the course.
   *   - `createMinimalSlidesFromTree` is the v1.9 "Generar
   *     diapositivas" toolbar action: it just creates a Slide row
   *     per node with the node's name/summary as the slide's
   *     title/description, and APPENDS to the existing list (the
   *     user explicitly chose not to replace — they may have
   *     already generated content for some slides).
   *
   * Same node → same shape on both sides (title from `name`,
   * description from `summary`, parent link from `parentId`,
   * `sourceNodeId` populated for traceability); the difference is
   * LLM usage and replacement semantics.
   *
   * Existing slides for the course are NOT touched: the user can
   * call this action multiple times (e.g. after editing the tree)
   * and the result is always additive. The `order` field for new
   * slides is set to `maxOrder + 1 + idx` so they land at the end
   * of the existing list.
   */
  async createMinimalSlidesFromTree(
    courseId: string,
    selectedNodeIds: string[]
  ): Promise<
    { id: string; courseId: string; title: string; description: string; order: number }[]
  > {
    if (selectedNodeIds.length === 0) {
      throw new Error("Selecciona al menos un nodo del árbol para crear diapositivas.");
    }

    const rows = await this.database.topicNode.findMany({
      where: { id: { in: selectedNodeIds }, courseId },
    });

    if (rows.length === 0) {
      throw new Error("Los nodos seleccionados no existen en este curso.");
    }

    const nodesById = new Map<string, TopicNode>();
    for (const row of rows) {
      nodesById.set(row.id, {
        id: row.id,
        courseId: row.courseId,
        parentId: row.parentId,
        name: row.name,
        summary: row.summary,
        depth: row.depth,
        orderIndex: row.orderIndex,
        isLeaf: row.isLeaf,
        version: row.version,
        sourceMaterialId: row.sourceMaterialId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      });
    }

    // v1.0 — order the new slides by a DFS pre-order of the tree (top-to-bottom),
    // so slides, the tree visual and the slides list all share the same order.
    // No LLM here: the toolbar action stays instant.
    const selectedNodes = selectedNodeIds
      .map((id) => nodesById.get(id))
      .filter((x): x is TopicNode => x !== undefined);
    const finalIds = dfsPreorder(selectedNodes).map((n) => n.id);

    // Compute the starting `order` so the new slides are appended
    // at the end of the existing list, not on top of existing rows.
    const tail = await this.database.slide.findFirst({
      where: { courseId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const startOrder = (tail?.order ?? -1) + 1;

    // First pass: create slides without parent links. The parent
    // slide may be created later in the same batch, so we resolve
    // `parentSlideId` in a second pass.
    const created = await this.database.$transaction(
      finalIds.map((id, idx) => {
        const node = nodesById.get(id);
        if (!node) {
          // Should never happen because we filtered finalIds above.
          throw new Error(`Nodo no encontrado: ${id}`);
        }
        return this.database.slide.create({
          data: {
            courseId,
            title: node.name,
            description: node.summary ?? "",
            order: startOrder + idx,
            sourceNodeId: node.id,
            // htmlDesign is left null — the slide page is the place
            // where the user (or a subsequent "Generar todo" call)
            // fills it in.
            // boxes is implicitly empty — no SlideBox rows are
            // created here. The slides page derives `hasContent`
            // from the box count, so empty boxes == "Sin
            // contenido" badge.
          },
        });
      })
    );

    const slideIdByNodeId = new Map<string, string>();
    created.forEach((slide, i) => {
      slideIdByNodeId.set(finalIds[i], slide.id);
    });

    // Second pass: link each new slide to its parent's slide (if
    // any) based on the source TopicNode's parentId. This is the
    // same pattern `generateOutlineFromTree` uses — it just runs
    // over a much smaller set (the new slides only, not the
    // entire course).
    const parentUpdates: { id: string; parentSlideId: string | null }[] = [];
    for (const id of finalIds) {
      const node = nodesById.get(id);
      if (!node) continue;
      const slideId = slideIdByNodeId.get(node.id);
      if (!slideId) continue;
      // The parent slide might already exist (existing slide for
      // the parent node from a previous batch) OR be created in
      // the same batch (when the parent is in finalIds too). Both
      // cases are handled by looking up via `slideIdByNodeId` first
      // and falling back to the DB only when the parent node is
      // not in the current selection.
      let parentSlideId: string | null = null;
      if (node.parentId) {
        parentSlideId = slideIdByNodeId.get(node.parentId) ?? null;
        if (parentSlideId === null) {
          const existing = await this.database.slide.findFirst({
            where: { courseId, sourceNodeId: node.parentId },
            select: { id: true },
          });
          parentSlideId = existing?.id ?? null;
        }
      }
      if (parentSlideId !== null) {
        parentUpdates.push({ id: slideId, parentSlideId });
      }
    }

    if (parentUpdates.length > 0) {
      await this.database.$transaction(
        parentUpdates.map((u) =>
          this.database.slide.update({
            where: { id: u.id },
            data: { parentSlideId: u.parentSlideId },
          })
        )
      );
    }

    // Return the freshly-created slides with the parent links
    // resolved. We only return the NEW rows, not the existing
    // ones — the caller (slides page) is already aware of the
    // existing list.
    return created.map((slide) => ({
      id: slide.id,
      courseId: slide.courseId,
      title: slide.title,
      description: slide.description,
      order: slide.order,
    }));
  }

  /**
   * Ask the LLM to return the input nodes in a pedagogically-sensible
   * order. Returns an array of node ids in the recommended order. If the
   * LLM fails to return a valid order, the caller falls back to the
   * selection order via `normalizeOrder`.
   */
  private async organizePedagogically(
    nodes: TopicNode[]
  ): Promise<string[] | null> {
    const { system, user } = this.promptManager.buildOutlinePrompt(nodes);

    const response = await this.llmClient.chatJSON<{ order?: string[] }>([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    if (Array.isArray(response.order)) {
      return response.order.filter((id): id is string => typeof id === "string");
    }
    return null;
  }

  /**
   * Reconcile the LLM-returned order with the originally selected ids.
   * Drops any id the LLM hallucinated or that wasn't in the selection,
   * and appends any selection id the LLM omitted — preserving the
   * selection order for the appended ones. If `llmOrder` is null (the
   * LLM call returned no usable order), the selection order is used
   * unchanged.
   */
  private normalizeOrder(
    llmOrder: string[] | null,
    selected: string[]
  ): string[] {
    if (llmOrder === null) {
      return [...selected];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of llmOrder) {
      if (selected.includes(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    for (const id of selected) {
      if (!seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    return out;
  }

  /**
   * v1.10 / Wave 1 — public wrapper used by `SlideGenerationQueue` to
   * drive content generation for a single slide. The queue invokes this
   * method as Step 1 of the two-step generation pipeline
   * (content → HTML); the underlying logic is identical to
   * `generateSlideContent`, which the BullMQ worker also calls. Keeping
   * the method as a thin pass-through avoids code duplication while
   * exposing a stable, queue-friendly name to the infrastructure layer.
   */
  async generateContentForSlide(slideId: string): Promise<GeneratedBoxes> {
    return this.generateSlideContent(slideId);
  }

  /**
   * v1.10 / Wave 1 — public wrapper used by `SlideGenerationQueue` to
   * drive HTML design generation for a single slide (Step 2 of the
   * pipeline). Calls the existing `regenerateHtmlDesign` with an empty
   * `designInstructions` string, matching the auto-generation path
   * used by the slides page (see `slides-client.tsx` line ~99, which
   * invokes `regenerateHtmlDesign(slideId, "")`). No behaviour change
   * for callers; the method exists so the queue has a stable
   * single-argument entry point.
   */
  async generateHtmlForSlide(slideId: string): Promise<string> {
    return this.regenerateHtmlDesign(slideId, "");
  }

  async generateSlideContent(slideId: string): Promise<GeneratedBoxes> {
    const slide = await this.database.slide.findUnique({
      where: { id: slideId },
      include: { course: { include: { materials: true } } },
    });

    if (!slide) throw new Error("Diapositiva no encontrada");

    // Retrieve relevant chunks via RAG for each material
    const relevantChunks: RelevantChunk[] = [];
    for (const material of slide.course.materials) {
      const chunks = await this.ragEngine.searchRelevant(
        slide.title,
        material.id,
        3
      );
      relevantChunks.push(...chunks);
    }

    relevantChunks.sort((a, b) => b.score - a.score);
    const ragText = relevantChunks
      .slice(0, 5)
      .map((c) => c.content)
      .join("\n\n");

    const sourceText =
      ragText || slide.course.materials.map((m) => m.content).join("\n\n") || "";

    let figureRefs: string[] = [];
    try {
      figureRefs = JSON.parse(slide.figureRefs);
    } catch {
      figureRefs = [];
    }

    const { system, user } = this.promptManager.buildBoxesPrompt(
      slide.title,
      slide.description,
      sourceText,
      figureRefs
    );

    const boxes = await this.llmClient.chatJSON<GeneratedBoxes>([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    const result: GeneratedBoxes = {
      script: boxes.script || "Contenido no generado.",
      relevance: boxes.relevance || "Relevancia no generada.",
      narrative: boxes.narrative || "Narrativa no generada.",
      exercise1: boxes.exercise1 || "Ejercicio no generado.",
      exercise2: boxes.exercise2 || "Ejercicio no generado.",
    };

    await this.boxService.initializeBoxesForSlide(slideId, result);

    return result;
  }

  async regenerateHtmlDesign(
    slideId: string,
    designInstructions: string
  ): Promise<string> {
    const slide = await this.database.slide.findUnique({
      where: { id: slideId },
      include: {
        boxes: true,
        course: { include: { materials: true } },
      },
    });

    if (!slide) throw new Error("Diapositiva no encontrada");

    const getBox = (type: string) =>
      slide.boxes.find((b) => b.type === type)?.content ?? "";

    const { system, user } = this.promptManager.buildHtmlDesignPrompt(
      slide.title,
      slide.description,
      getBox(BoxType.SCRIPT),
      getBox(BoxType.RELEVANCE),
      getBox(BoxType.NARRATIVE),
      designInstructions
    );

    const response = await this.llmClient.chatJSON<{ html: string }>([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);

    if (!response.html) {
      throw new Error("La IA no generó un diseño HTML válido.");
    }

    await this.database.slide.update({
      where: { id: slideId },
      data: { htmlDesign: response.html },
    });

    return response.html;
  }
}

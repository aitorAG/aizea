import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJSON, type ChatMessage } from "@/lib/domain/llm/LLMClient";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { RAGEngine, type RelevantChunk } from "@/lib/domain/rag/RAGEngine";
import { BoxType, type GeneratedBoxes } from "@/lib/types";
import type { TopicNode } from "@/lib/types/pipeline";

export interface LLMClientInterface {
  chatJSON: <T>(messages: ChatMessage[]) => Promise<T>;
}

export class SlideService {
  constructor(
    private llmClient: LLMClientInterface = { chatJSON },
    private promptManager: PromptManager = new PromptManager(),
    private ragEngine: RAGEngine = new RAGEngine(),
    private database: PrismaClient = db
  ) {}

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

    const slides = finalIds.map((id, idx) => {
      const node = nodesById.get(id);
      if (!node) {
        // Should never happen because normalizeOrder preserves selectedNodeIds.
        throw new Error(`Nodo no encontrado: ${id}`);
      }
      return {
        courseId,
        title: node.name,
        description: node.summary ?? "",
        order: idx,
      };
    });

    const created = await this.database.slide.createManyAndReturn({
      data: slides,
    });

    return created;
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

  async generateSlideContent(slideId: string): Promise<GeneratedBoxes> {
    const slide = await this.database.slide.findUnique({
      where: { id: slideId },
      include: { course: { include: { materials: true } } },
    });

    if (!slide) throw new Error("Diapositiva no encontrada");

    // Retrieve relevant chunks via RAG for each material
    let relevantChunks: RelevantChunk[] = [];
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

    await this.initializeBoxesForSlide(slideId, result);

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

  async reorderSlides(courseId: string, slideIds: string[]): Promise<void> {
    const updates = slideIds.map((id, index) =>
      this.database.slide.update({
        where: { id },
        data: { order: index },
      })
    );
    await Promise.all(updates);
  }

  async createSlide(courseId: string, title: string, description: string) {
    const maxOrder = await this.database.slide.findFirst({
      where: { courseId },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    return this.database.slide.create({
      data: {
        courseId,
        title,
        description,
        order: (maxOrder?.order ?? -1) + 1,
      },
    });
  }

  async updateSlide(
    slideId: string,
    data: { title?: string; description?: string; htmlDesign?: string }
  ) {
    return this.database.slide.update({
      where: { id: slideId },
      data,
    });
  }

  async deleteSlide(slideId: string) {
    const slide = await this.database.slide.findUnique({
      where: { id: slideId },
    });
    if (!slide) throw new Error("Diapositiva no encontrada");

    await this.database.slide.delete({ where: { id: slideId } });
  }

  async updateBox(boxId: string, content: string) {
    return this.database.slideBox.update({
      where: { id: boxId },
      data: { content },
    });
  }

  async getBoxesForSlide(slideId: string) {
    return this.database.slideBox.findMany({
      where: { slideId },
    });
  }

  async initializeBoxesForSlide(
    slideId: string,
    boxes: GeneratedBoxes
  ) {
    await this.database.slideBox.deleteMany({ where: { slideId } });

    const boxTypes = [
      { type: BoxType.SCRIPT, content: boxes.script },
      { type: BoxType.RELEVANCE, content: boxes.relevance },
      { type: BoxType.NARRATIVE, content: boxes.narrative },
      { type: BoxType.EXERCISE_1, content: boxes.exercise1 },
      { type: BoxType.EXERCISE_2, content: boxes.exercise2 },
    ];

    await this.database.slideBox.createMany({
      data: boxTypes.map((b) => ({
        slideId,
        type: b.type,
        content: b.content,
      })),
    });
  }
}

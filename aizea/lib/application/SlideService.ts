import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { chatJSON } from "@/lib/infrastructure/ai/llm-client";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import { RAGEngine } from "@/lib/domain/rag/RAGEngine";
import { createRAGEngine } from "@/lib/infrastructure/rag/rag-engine.factory";
import { SlideBoxService } from "@/lib/application/SlideBoxService";
import { SlideCrudService } from "@/lib/application/SlideCrudService";
import type { IFigureStore } from "@/lib/application/ports/figure-store.port";
import { FsFigureStore } from "@/lib/infrastructure/figures/figure-store";
import {
  SlideGenerationService,
  type LLMClientInterface,
} from "@/lib/application/SlideGenerationService";
import { type GeneratedBoxes } from "@/lib/types";

export type { LLMClientInterface };

/**
 * SlideService — FACHADA fina sobre tres colaboradores con responsabilidad
 * única (CA-7). Antes era un fichero-dios de 581 líneas con 6
 * responsabilidades mezcladas; la Fase 1 del plan de reescritura selectiva las
 * extrajo a:
 *
 *   - `SlideGenerationService` — generación IA (outline, minimal-slides,
 *      content-gen con RAG, html-design).
 *   - `SlideCrudService` — CRUD y reordenación de diapositivas.
 *   - `SlideBoxService` — ciclo de vida de las cajas de contenido.
 *
 * Esta fachada se conserva para NO romper el contrato público consumido por
 * tests, server actions y la cola de generación. Los consumidores nuevos deben
 * depender del colaborador concreto que necesiten, no de esta fachada.
 */
export class SlideService {
  private readonly boxService: SlideBoxService;
  private readonly crudService: SlideCrudService;
  private readonly generationService: SlideGenerationService;

  constructor(
    llmClient: LLMClientInterface = { chatJSON },
    promptManager: PromptManager = new PromptManager(),
    ragEngine: RAGEngine = createRAGEngine(),
    database: PrismaClient = db,
    // v1.0 — figure store for figure-slide generation. Defaults to the FS store
    // (desktop/web); tests can inject a fake or omit it (concept-only slides).
    figureStore: IFigureStore = new FsFigureStore()
  ) {
    // Todos los colaboradores comparten la misma conexión Prisma inyectada para
    // preservar el comportamiento en tests (BD de test compartida).
    this.boxService = new SlideBoxService(database);
    this.crudService = new SlideCrudService(database);
    this.generationService = new SlideGenerationService(
      llmClient,
      promptManager,
      ragEngine,
      database,
      this.boxService,
      figureStore
    );
  }

  // ── Generación IA: delegada en SlideGenerationService ──────────────────
  async generateOutlineFromTree(courseId: string, selectedNodeIds: string[]) {
    return this.generationService.generateOutlineFromTree(courseId, selectedNodeIds);
  }

  async createMinimalSlidesFromTree(courseId: string, selectedNodeIds: string[]) {
    return this.generationService.createMinimalSlidesFromTree(courseId, selectedNodeIds);
  }

  async generateContentForSlide(slideId: string): Promise<GeneratedBoxes> {
    return this.generationService.generateContentForSlide(slideId);
  }

  async generateHtmlForSlide(slideId: string): Promise<string> {
    return this.generationService.generateHtmlForSlide(slideId);
  }

  async generateSlideContent(slideId: string): Promise<GeneratedBoxes> {
    return this.generationService.generateSlideContent(slideId);
  }

  async regenerateHtmlDesign(slideId: string, designInstructions: string): Promise<string> {
    return this.generationService.regenerateHtmlDesign(slideId, designInstructions);
  }

  // ── CRUD de diapositivas: delegado en SlideCrudService ─────────────────
  async reorderSlides(courseId: string, slideIds: string[]): Promise<void> {
    return this.crudService.reorderSlides(courseId, slideIds);
  }

  async createSlide(courseId: string, title: string, description: string) {
    return this.crudService.createSlide(courseId, title, description);
  }

  async updateSlide(
    slideId: string,
    data: { title?: string; description?: string; htmlDesign?: string }
  ) {
    return this.crudService.updateSlide(slideId, data);
  }

  async deleteSlide(slideId: string) {
    return this.crudService.deleteSlide(slideId);
  }

  // ── Cajas: delegadas en SlideBoxService ────────────────────────────────
  async updateBox(boxId: string, content: string) {
    return this.boxService.updateBox(boxId, content);
  }

  async getBoxesForSlide(slideId: string) {
    return this.boxService.getBoxesForSlide(slideId);
  }

  async initializeBoxesForSlide(slideId: string, boxes: GeneratedBoxes) {
    return this.boxService.initializeBoxesForSlide(slideId, boxes);
  }
}

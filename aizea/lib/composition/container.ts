// Composition root.
//
// This is the ONLY file in the application that knows about concrete
// implementations. Every other module — actions, use cases, domain
// services, infrastructure adapters — sees the world through ports.
//
// The container exposes the use cases the action layer needs. Tests
// can construct their own container with fakes (`createContainer({ ... })`)
// so the same action layer can be exercised without touching the
// database, network, or filesystem.

import { PipelineService } from "@/lib/infrastructure/pipeline/pipeline.service";
import { PrismaJobQueue } from "@/lib/infrastructure/queue/prisma-job-queue";
import { PipelineWorker } from "@/lib/infrastructure/queue/pipeline-worker";
import { PrismaMaterialRepository } from "@/lib/infrastructure/persistence/prisma-material.repository";
import { PrismaCourseRepository } from "@/lib/infrastructure/persistence/prisma-course.repository";
import { PrismaSlideRepository } from "@/lib/infrastructure/persistence/prisma-slide.repository";
import { PrismaSlideBoxRepository } from "@/lib/infrastructure/persistence/prisma-slide-box.repository";
import { PrismaTopicNodeRepository } from "@/lib/infrastructure/persistence/prisma-topic-node.repository";
import { PrismaProcessingJobRepository } from "@/lib/infrastructure/persistence/prisma-processing-job.repository";
import { PrismaFigureRepository } from "@/lib/infrastructure/persistence/prisma-figure.repository";
import { PrismaTextChunkRepository } from "@/lib/infrastructure/persistence/prisma-text-chunk.repository";
import { PrismaSettingsRepository } from "@/lib/infrastructure/persistence/prisma-settings.repository";
import { PrismaSemanticUnitRepository } from "@/lib/infrastructure/persistence/prisma-semantic-unit.repository";
import { InAppNotifier } from "@/lib/infrastructure/notifications/in-app.notifier";
import { ProcessCourseUseCase } from "@/lib/application/use-cases/process-course.use-case";
import {
  UploadMaterialUseCase,
  type UploadMaterialUseCaseDeps,
} from "@/lib/application/use-cases/upload-material.use-case";
import { PDFService } from "@/lib/domain/pdf/PDFService";
import { FigureExtractor } from "@/lib/domain/figures/FigureExtractor";
import { FsFigureStore } from "@/lib/infrastructure/figures/figure-store";
import { FigureRasterizer } from "@/lib/infrastructure/pdf/figure-rasterizer";
import { LayoutParser } from "@/lib/domain/pdf/LayoutParser";
import { createRAGEngine } from "@/lib/infrastructure/rag/rag-engine.factory";
import { getDoclingBaseUrl } from "@/lib/config-service";
import type { IPipelineService } from "@/lib/application/ports/pipeline.port";
import type { IMaterialRepository } from "@/lib/application/ports/material-repository.port";
import type { INotifier } from "@/lib/application/ports/notifier.port";
import type { ICourseRepository } from "@/lib/application/ports/course-repository.port";
import type { ISlideRepository } from "@/lib/application/ports/slide-repository.port";
import type { ISlideBoxRepository } from "@/lib/application/ports/slide-box-repository.port";
import type { ITopicNodeRepository } from "@/lib/application/ports/topic-node-repository.port";
import type { IProcessingJobRepository } from "@/lib/application/ports/processing-job-repository.port";
import type { IFigureRepository } from "@/lib/application/ports/figure-repository.port";
import type { ITextChunkRepository } from "@/lib/application/ports/text-chunk-repository.port";
import type { ISettingsRepository } from "@/lib/application/ports/settings-repository.port";
import type { ISemanticUnitRepository } from "@/lib/application/ports/semantic-unit-repository.port";
import type { IJobQueue } from "@/lib/application/ports/job-queue.port";
import type { IJobWorker } from "@/lib/infrastructure/queue/pipeline-worker";

export interface ContainerOverrides {
  pipeline?: IPipelineService;
  jobQueue?: IJobQueue;
  materials?: IMaterialRepository;
  notifier?: INotifier;
  courses?: ICourseRepository;
  slides?: ISlideRepository;
  slideBoxes?: ISlideBoxRepository;
  topicNodes?: ITopicNodeRepository;
  processingJobs?: IProcessingJobRepository;
  figures?: IFigureRepository;
  textChunks?: ITextChunkRepository;
  settings?: ISettingsRepository;
  semanticUnits?: ISemanticUnitRepository;
  /** Override the PDF text extractor (the upload use case accepts
   *  the duck-typed `IPdfTextExtractor`). */
  pdfExtractor?: UploadMaterialUseCaseDeps["pdfExtractor"];
  figureExtractor?: UploadMaterialUseCaseDeps["figureExtractor"];
  layoutParser?: UploadMaterialUseCaseDeps["layoutParser"];
  ragIndexer?: UploadMaterialUseCaseDeps["ragIndexer"];
}

export interface Container {
  processCourse: ProcessCourseUseCase;
  uploadMaterial: UploadMaterialUseCase;
  // Cola persistente + worker de fondo (Fase 2.1/2.2). El worker consume la
  // cola invocando `processCourse.execute` como primitiva síncrona.
  jobQueue: IJobQueue;
  pipelineWorker: IJobWorker;
  // Repositories — exposed so server actions can consume them via the
  // composition root instead of importing concrete implementations directly.
  materials: IMaterialRepository;
  courses: ICourseRepository;
  slides: ISlideRepository;
  slideBoxes: ISlideBoxRepository;
  topicNodes: ITopicNodeRepository;
  processingJobs: IProcessingJobRepository;
  figures: IFigureRepository;
  textChunks: ITextChunkRepository;
  settings: ISettingsRepository;
  semanticUnits: ISemanticUnitRepository;
}

export function createContainer(overrides: ContainerOverrides = {}): Container {
  const pipeline = overrides.pipeline ?? new PipelineService();
  const materials = overrides.materials ?? new PrismaMaterialRepository();
  const notifier = overrides.notifier ?? new InAppNotifier();
  const courses = overrides.courses ?? new PrismaCourseRepository();
  const slides = overrides.slides ?? new PrismaSlideRepository();
  const slideBoxes = overrides.slideBoxes ?? new PrismaSlideBoxRepository();
  const topicNodes = overrides.topicNodes ?? new PrismaTopicNodeRepository();
  const processingJobs = overrides.processingJobs ?? new PrismaProcessingJobRepository();
  const figures = overrides.figures ?? new PrismaFigureRepository();
  const textChunks = overrides.textChunks ?? new PrismaTextChunkRepository();
  const settings = overrides.settings ?? new PrismaSettingsRepository();
  const semanticUnits = overrides.semanticUnits ?? new PrismaSemanticUnitRepository();
  const pdfExtractor = overrides.pdfExtractor ?? new PDFService();
  const figureExtractor =
    overrides.figureExtractor ??
    new FigureExtractor(undefined, new FsFigureStore(), new FigureRasterizer());
  // Pass a lazy resolver so the Docling URL configured in /settings is always
  // used — avoiding the bug where LayoutParser was constructed with a hardcoded
  // URL and ignored the DB-stored value entirely.
  const layoutParser =
    overrides.layoutParser ??
    new LayoutParser({ getBaseUrl: getDoclingBaseUrl });
  const ragIndexer = overrides.ragIndexer ?? createRAGEngine();

  const jobQueue = overrides.jobQueue ?? new PrismaJobQueue();
  const processCourse = new ProcessCourseUseCase({ pipeline, materials, notifier });
  // The worker's runCourse is the synchronous pipeline primitive. Injecting a
  // closure (not the use case) keeps the worker decoupled and testable.
  const pipelineWorker = new PipelineWorker({
    queue: jobQueue,
    runCourse: (courseId: string) => processCourse.execute(courseId),
  });

  return {
    processCourse,
    // uploadMaterial does NOT receive `pipeline` (v1.5 finding 1.7):
    // the upload use case is intentionally decoupled from the pipeline.
    // The pipeline only runs on explicit "Generar árbol" via `processCourse`.
    uploadMaterial: new UploadMaterialUseCase({
      materials,
      notifier,
      pdfExtractor,
      figureExtractor,
      layoutParser,
      ragIndexer,
    }),
    materials,
    courses,
    slides,
    slideBoxes,
    topicNodes,
    processingJobs,
    figures,
    textChunks,
    settings,
    semanticUnits,
    jobQueue,
    pipelineWorker,
  };
}

/** Singleton container for the production code path. Tests should
 *  call `createContainer({...})` directly. */
export const container: Container = createContainer();

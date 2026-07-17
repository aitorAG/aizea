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
import { PrismaMaterialRepository } from "@/lib/infrastructure/persistence/prisma-material.repository";
import { InAppNotifier } from "@/lib/infrastructure/notifications/in-app.notifier";
import { ProcessCourseUseCase } from "@/lib/application/use-cases/process-course.use-case";
import {
  UploadMaterialUseCase,
  type UploadMaterialUseCaseDeps,
} from "@/lib/application/use-cases/upload-material.use-case";
import { PDFService } from "@/lib/domain/pdf/PDFService";
import { FigureExtractor } from "@/lib/domain/figures/FigureExtractor";
import { LayoutParser } from "@/lib/domain/pdf/LayoutParser";
import { RAGEngine } from "@/lib/domain/rag/RAGEngine";
import type { IPipelineService } from "@/lib/application/ports/pipeline.port";
import type { IMaterialRepository } from "@/lib/application/ports/material-repository.port";
import type { INotifier } from "@/lib/application/ports/notifier.port";

export interface ContainerOverrides {
  pipeline?: IPipelineService;
  materials?: IMaterialRepository;
  notifier?: INotifier;
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
}

export function createContainer(overrides: ContainerOverrides = {}): Container {
  const pipeline = overrides.pipeline ?? new PipelineService();
  const materials = overrides.materials ?? new PrismaMaterialRepository();
  const notifier = overrides.notifier ?? new InAppNotifier();
  const pdfExtractor = overrides.pdfExtractor ?? new PDFService();
  const figureExtractor = overrides.figureExtractor ?? new FigureExtractor();
  const layoutParser = overrides.layoutParser ?? new LayoutParser();
  const ragIndexer = overrides.ragIndexer ?? new RAGEngine();

  return {
    processCourse: new ProcessCourseUseCase({ pipeline, materials, notifier }),
    uploadMaterial: new UploadMaterialUseCase({
      materials,
      pipeline,
      notifier,
      pdfExtractor,
      figureExtractor,
      layoutParser,
      ragIndexer,
    }),
  };
}

/** Singleton container for the production code path. Tests should
 *  call `createContainer({...})` directly. */
export const container: Container = createContainer();

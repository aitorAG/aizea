import { Worker } from "bullmq";
import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { SlideService } from "@/lib/application/SlideService";
import { UnitExtractor } from "@/lib/domain/pipeline/UnitExtractor";
import type { JobName, JobData } from "./JobQueue";

/**
 * Default job options for the extract-unit queue:
 *   - 3 attempts (matches the global default for retries)
 *   - exponential backoff starting at 1s (1s, 2s, 4s) so OpenRouter
 *     rate-limits have time to clear
 * Concurrency is 3 to keep OpenRouter pressure modest while still
 * saturating three parallel extraction jobs per worker process.
 */
const EXTRACT_UNIT_CONCURRENCY = 3;

export function createWorkers(redisUrl?: string) {
  const connection = {
    url: redisUrl ?? config.redis.url,
  };

  const slideService = new SlideService();
  const unitExtractor = new UnitExtractor();

  const outlineWorker = new Worker(
    "aizea-jobs",
    async (job) => {
      if (job.name === "generate-outline") {
        const data = job.data as JobData["generate-outline"];
        await slideService.generateOutlineFromTree(
          data.courseId,
          data.selectedNodeIds
        );
      }
    },
    { connection, concurrency: 2 }
  );

  const contentWorker = new Worker(
    "aizea-jobs",
    async (job) => {
      if (job.name === "generate-slide-content") {
        const data = job.data as JobData["generate-slide-content"];
        await slideService.generateSlideContent(data.slideId);
      }
      if (job.name === "generate-all-slides") {
        const data = job.data as JobData["generate-all-slides"];
        const slides = await db.slide.findMany({
          where: { courseId: data.courseId },
          orderBy: { order: "asc" },
        });
        for (const slide of slides) {
          await slideService.generateSlideContent(slide.id);
        }
      }
    },
    { connection, concurrency: 2 }
  );

  /**
   * Worker for the new "extract-unit" job type. Loads the SemanticUnit
   * from the DB, calls UnitExtractor.extract(), and lets BullMQ handle
   * the retry/backoff via the queue's default options. Failures propagate
   * so the job is marked as failed and can be retried.
   */
  const extractUnitWorker = new Worker(
    "aizea-jobs",
    async (job) => {
      if (job.name === "extract-unit") {
        const data = job.data as JobData["extract-unit"];
        const unit = await db.semanticUnit.findUnique({
          where: { id: data.unitId },
        });
        if (!unit) {
          throw new Error(
            `extract-unit: SemanticUnit not found: ${data.unitId}`
          );
        }
        await unitExtractor.extract({
          id: unit.id,
          materialId: unit.materialId,
          content: unit.content,
          order: unit.order,
          pageStart: unit.pageStart,
          pageEnd: unit.pageEnd,
          sectionRef: unit.sectionRef,
          createdAt: unit.createdAt.toISOString(),
        });
      }
    },
    {
      connection,
      concurrency: EXTRACT_UNIT_CONCURRENCY,
    }
  );

  return [outlineWorker, contentWorker, extractUnitWorker];
}

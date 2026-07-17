// Ports for the critical-path use cases.
//
// A "port" in hexagonal architecture is the contract that the
// application layer (use cases) depends on. Implementations live in
// `lib/infrastructure/`. Use cases receive concrete instances via the
// composition root (`lib/composition/container.ts`) so they can be
// tested with fakes without touching the database, network, or file
// system.
//
// Why this shape: each port is the minimum surface the use cases
// actually need. Adding more methods here would couple the use case
// to implementation details; adding fewer would force the use case
// to be aware of how its data is stored. The rule of thumb: a port
// is a use-case-shaped interface, not a repository-shaped one.

import type { ProcessingStatus } from "@/lib/types/pipeline";

/** Input to the pipeline orchestrator. The orchestrator picks the
 *  appropriate execution mode based on which fields are populated:
 *
 *   - `buffer + materialId` → segment the buffer from scratch.
 *   - `materialId` only     → re-run on existing units for that material.
 *   - `courseId` only       → re-run on existing units for the course.
 *
 *  This is the existing `PipelineService.run(courseId, materialId?, buffer?)`
 *  shape, lifted out of the orchestrator and into a port so the use
 *  case decides which mode to invoke (the orchestrator no longer
 *  guesses). */
export interface ProcessCourseInput {
  courseId: string;
  materialId?: string;
  buffer?: Buffer;
  /** Set to true when the use case forces a fresh run from disk even
   *  if existing units are present. Used to recover from a prior
   *  failed segmentation (e.g. docling-serve was down at upload time). */
  force?: boolean;
}

/** Result of a single pipeline run. Mirrors the existing
 *  `PipelineService.run` return shape so the action layer can keep
 *  its current contract. */
export interface ProcessCourseResult {
  segmentationJobId: string;
  extractionJobId: string;
  integrationJobId: string;
  treeBuildingJobId: string;
  /** True when the segmentation phase found nothing to process. The
   *  remaining phases are skipped. */
  empty: boolean;
  /** Human-friendly explanation; populated only when `empty`. */
  message: string | null;
}

/** Snapshot of a ProcessingJob — used by the action layer to answer
 *  `getJobStatus` polls. */
export interface JobStatus {
  id: string;
  type: string;
  status: ProcessingStatus;
  progress: number;
  total: number;
  currentStep: string | null;
  error: string | null;
  courseId: string | null;
  materialId: string | null;
}

/** Compact description of a running/recently-completed job, used by
 *  the `listActiveJobs` query for the global pipeline banner. */
export interface ActiveJob {
  jobId: string;
  courseId: string | null;
  phase: string;
  status: ProcessingStatus;
  progress: number;
  currentStep: string | null;
  error: string | null;
  startedAt: number;
  updatedAt: number;
}

/** Pipeline orchestrator contract.
 *
 *  The use case depends on this port (not on `PipelineService`
 *  directly) so it can be unit-tested with a fake. Production wires
 *  up the Prisma-backed `PipelineService` in the composition root. */
export interface IPipelineService {
  /** Run the four-phase pipeline for a course. */
  processCourse(input: ProcessCourseInput): Promise<ProcessCourseResult>;

  /** Look up a ProcessingJob by id. */
  getStatus(jobId: string): Promise<JobStatus | null>;

  /** Cancel a running job (idempotent on terminal states). */
  cancel(jobId: string): Promise<{ status: ProcessingStatus }>;

  /** List jobs that the global banner should surface. */
  getActiveJobs(): Promise<ActiveJob[]>;
}

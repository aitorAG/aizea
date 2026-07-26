// Material repository port.
//
// Encapsulates the storage concerns the use cases need:
//   * existence queries (does the course have materials? does the
//     material have processed units?)
//   * file system access (re-read the original PDF from disk so the
//     pipeline can re-segment when docling-serve was down at upload)
//   * CRUD for materials
//
// Implementations live in `lib/infrastructure/persistence/`. The
// Prisma + filesystem implementation is `PrismaMaterialRepository`.

export interface CreateMaterialInput {
  courseId: string;
  filename: string;
  content: string;
  pageCount: number;
  fileSize: number | null;
  fileType: string | null;
  /** Raw bytes for the original upload. Implementations are
   *  responsible for persisting them to durable storage. */
  buffer: Buffer;
}

/** The shape the use cases work with. Mirrors the Prisma `Material`
 *  row but is owned by the application layer so the use cases do
 *  not depend on a Prisma type. */
export interface Material {
  id: string;
  courseId: string;
  filename: string;
  content: string;
  pageCount: number;
  fileSize: number | null;
  fileType: string | null;
  createdAt: string;
}

/** Material repository contract.
 *
 *  Why this shape: the use cases ask "do I have any materials for
 *  this course?" and "can I read the file from disk?" — these are
 *  not transactional queries a generic `findById` + service
 *  hand-off can answer cleanly. The port exposes the read patterns
 *  the use cases actually use. */
export interface IMaterialRepository {
  /** Return a material by its id, or null when it does not exist. */
  findById(id: string): Promise<Material | null>;

  /** List every material for a course, ordered by creation time
   *  ascending (oldest first). The order matters: the "Generar
   *  árbol" use case reads the latest one to recover from a prior
   *  failed segmentation. */
  findByCourseId(courseId: string): Promise<Material[]>;

  /** True when the material has at least one `SemanticUnit`. This
   *  is the use case's signal that a previous segmentation
   *  succeeded and the pipeline can skip phase 1. */
  hasProcessedUnits(materialId: string): Promise<boolean>;

  /** Re-read the original PDF bytes from durable storage. Returns
   *  null when the file is missing (e.g. the uploads directory was
   *  wiped). The use case surfaces `FILE_MISSING` in that case so
   *  the user can re-upload. */
  readBuffer(materialId: string): Promise<Buffer | null>;

  /** Create a new material row, persist the buffer to durable
   *  storage, and return the persisted row. */
  create(data: CreateMaterialInput): Promise<Material>;

  /** Delete a material and its dependent TextChunks atomically.
   *  No-op semantics: deleting a non-existent id is a silent no-op
   *  (the action layer already guards with a prior existence check,
   *  but the repository stays safe on its own). */
  delete(id: string): Promise<void>;
}

// Material — domain entity.
//
// The application layer talks about `Material` through the
// `IMaterialRepository` port. The entity below is the same shape
// the repository returns; it intentionally mirrors the Prisma row
// (so the mapping is trivial) but does NOT depend on the Prisma
// type. This keeps the use cases free of an ORM dependency and
// makes it possible to swap the persistence layer later.

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

/** Factory: validate + normalize a Material from a Prisma row. The
 *  Prisma row uses `Date` for `createdAt`; the entity uses ISO
 *  string for JSON-safety across server actions. */
export function materialFromRow(row: {
  id: string;
  courseId: string;
  filename: string;
  content: string;
  pageCount: number;
  fileSize: number | null;
  fileType: string | null;
  createdAt: Date;
}): Material {
  return {
    id: row.id,
    courseId: row.courseId,
    filename: row.filename,
    content: row.content,
    pageCount: row.pageCount,
    fileSize: row.fileSize,
    fileType: row.fileType,
    createdAt: row.createdAt.toISOString(),
  };
}

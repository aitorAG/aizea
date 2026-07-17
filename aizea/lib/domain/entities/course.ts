// Course — domain entity.
//
// Lighter than Material because the use cases only need a course
// id + name. Kept here for symmetry so future use cases (e.g.
// "duplicate course") can depend on the same shape.

export interface Course {
  id: string;
  name: string;
  llmContext: string | null;
  createdAt: string;
  updatedAt: string;
}

export function courseFromRow(row: {
  id: string;
  name: string;
  llmContext: string | null;
  createdAt: Date;
  updatedAt: Date;
}): Course {
  return {
    id: row.id,
    name: row.name,
    llmContext: row.llmContext,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ICourseRepository — port for Course persistence.

export interface CourseSummary {
  id: string;
  name: string;
  llmContext: string | null;
  slideCount: number;
  materialCount: number;
  figureCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICourseRepository {
  findAll(): Promise<CourseSummary[]>;
  findById(id: string): Promise<{ id: string; name: string; llmContext: string | null } | null>;
  create(input: { name: string; llmContext?: string }): Promise<{ id: string }>;
  update(id: string, data: { name?: string; llmContext?: string | null }): Promise<void>;
  delete(id: string): Promise<void>;
  exists(id: string): Promise<boolean>;
}

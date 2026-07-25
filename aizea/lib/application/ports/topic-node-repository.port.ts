// ITopicNodeRepository — port for TopicNode persistence.

export interface TopicNodeRow {
  id: string;
  courseId: string;
  parentId: string | null;
  name: string;
  summary: string | null;
  depth: number;
  isLeaf: boolean;
  version: number;
  sourceMaterialId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITopicNodeRepository {
  findByCourseId(courseId: string): Promise<TopicNodeRow[]>;
  findById(id: string): Promise<TopicNodeRow | null>;
  create(data: Omit<TopicNodeRow, "id" | "createdAt" | "updatedAt">): Promise<TopicNodeRow>;
  createMany(data: Omit<TopicNodeRow, "id" | "createdAt" | "updatedAt">[]): Promise<void>;
  update(id: string, data: Partial<TopicNodeRow>): Promise<TopicNodeRow>;
  updateMany(ids: string[], data: Partial<TopicNodeRow>): Promise<void>;
  delete(id: string): Promise<void>;
  deleteMany(ids: string[]): Promise<void>;
  countByCourseId(courseId: string): Promise<number>;
}

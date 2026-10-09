// ISlideRepository — port for Slide persistence.

export interface SlideRow {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
  figureRefs: string;
  htmlDesign: string | null;
  status: string;
  parentSlideId: string | null;
  sourceNodeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ISlideRepository {
  findById(id: string): Promise<SlideRow | null>;
  /** Returns only { courseId } — used to resolve revalidation paths. */
  findCourseIdById(id: string): Promise<{ courseId: string } | null>;
  findByCourseId(courseId: string): Promise<SlideRow[]>;
  create(data: Omit<SlideRow, "createdAt" | "updatedAt">): Promise<SlideRow>;
  update(id: string, data: Partial<SlideRow>): Promise<SlideRow>;
  delete(id: string): Promise<void>;
  deleteByCourseId(courseId: string): Promise<void>;
  maxOrderByCourseId(courseId: string): Promise<number>;
  // v0.12.0 (RC3) — persist generation status for recovery after navigation
  updateStatus(id: string, status: string): Promise<void>;
  // v0.12.0 (RC2) — finished jobs window needs all slides for grouping
  findAll(): Promise<SlideRow[]>;
}

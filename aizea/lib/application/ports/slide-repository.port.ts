// ISlideRepository — port for Slide persistence.

import type { SlideStatus } from "@prisma/client";

export interface SlideRow {
  id: string;
  courseId: string;
  title: string;
  description: string;
  order: number;
  figureRefs: string;
  htmlDesign: string | null;
  status: SlideStatus;
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
}

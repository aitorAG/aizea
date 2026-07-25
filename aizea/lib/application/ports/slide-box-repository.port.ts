// ISlideBoxRepository — port for SlideBox persistence.

import type { BoxType } from "@/lib/types";

export interface SlideBoxRow {
  id: string;
  slideId: string;
  type: string;
  content: string;
}

export interface ISlideBoxRepository {
  findBySlideId(slideId: string): Promise<SlideBoxRow[]>;
  update(id: string, content: string): Promise<SlideBoxRow>;
  /** Atomically replace all boxes for a slide (deleteMany + createMany in $transaction). */
  replaceForSlide(slideId: string, boxes: { type: string; content: string }[]): Promise<void>;
}

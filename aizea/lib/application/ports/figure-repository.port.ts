// IFigureRepository — port for Figure persistence.

export interface FigureRow {
  id: string;
  courseId: string;
  filename: string;
  caption: string | null;
  pageNum: number | null;
  tags: string;
  createdAt: Date;
}

export interface IFigureRepository {
  findByCourseId(courseId: string): Promise<FigureRow[]>;
  /** Used by UnitExtractor — includes courseId filter to prevent cross-course leaks. */
  findByPageRange(courseId: string, pageStart: number, pageEnd: number): Promise<FigureRow[]>;
  create(data: Omit<FigureRow, "id" | "createdAt">): Promise<FigureRow>;
  update(id: string, data: Partial<FigureRow>): Promise<FigureRow>;
  replaceAllForCourse(courseId: string, figures: Omit<FigureRow, "id" | "createdAt">[]): Promise<void>;
}

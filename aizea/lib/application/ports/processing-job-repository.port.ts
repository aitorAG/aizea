// IProcessingJobRepository — port for ProcessingJob persistence.

export interface ProcessingJobRow {
  id: string;
  type: string;
  status: string;
  progress: number;
  total: number;
  currentStep: string | null;
  error: string | null;
  courseId: string | null;
  materialId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProcessingJobWithCourseName extends ProcessingJobRow {
  courseName: string | null;
}

export interface IProcessingJobRepository {
  findById(id: string): Promise<ProcessingJobRow | null>;
  create(data: Omit<ProcessingJobRow, "createdAt" | "updatedAt">): Promise<ProcessingJobRow>;
  update(id: string, data: Partial<ProcessingJobRow>): Promise<ProcessingJobRow>;
  findRecentWithCourseNames(options: {
    windowMs: number;
    courseId?: string;
    statusFilter?: string[];
    terminalStatuses?: string[];
  }): Promise<ProcessingJobWithCourseName[]>;
}

// Shared types between API and UI
export { BoxType } from "./slide";
export * from "./pipeline";

export interface CourseSummary {
  id: string;
  name: string;
  slideCount: number;
  materialCount: number;
  updatedAt: string;
}

export interface SlideOutline {
  id: string;
  title: string;
  description: string;
  order: number;
}

export interface SlideContent {
  id: string;
  title: string;
  description: string;
  boxes: {
    script: string;
    relevance: string;
    narrative: string;
    exercise1: string;
    exercise2: string;
  };
  figureRefs: string[];
}

export interface GeneratedOutline {
  title: string;
  description: string;
  order: number;
}

export interface GeneratedBoxes {
  script: string;
  relevance: string;
  narrative: string;
  exercise1: string;
  exercise2: string;
}

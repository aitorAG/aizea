// Box type identifiers for slide content boxes.
// Values match the existing Prisma `slideBox.type` string column — do not rename.

export enum BoxType {
  SCRIPT = "script",
  RELEVANCE = "relevance",
  NARRATIVE = "narrative",
  EXERCISE_1 = "exercise1",
  EXERCISE_2 = "exercise2",
}

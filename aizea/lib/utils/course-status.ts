// getCourseStatus — derive the "has tree / has slides" boolean pair that
// the dashboard uses to colour its status icons.
//
// Why a helper instead of inline
// ------------------------------
// The dashboard server component already fetches a `_count` aggregate for
// slides and materials. Adding a third count (TopicNode) is the natural
// extension. The boolean conversion `count > 0` lives in this helper so
// the page.tsx mapping stays a pure data-shape transform, and so the
// unit tests can pin the contract independently of any DB mocks.

export interface CourseStatus {
  /** True when the course has at least one TopicNode. */
  hasTree: boolean;
  /** True when the course has at least one Slide. */
  hasSlides: boolean;
  /** Raw count, kept for callers that want to display the number. */
  topicNodeCount: number;
  /** Raw count, kept for callers that want to display the number. */
  slideCount: number;
}

/**
 * Pure function: converts the (topicNodeCount, slideCount) pair returned
 * by Prisma's `_count` aggregate into the boolean status the dashboard
 * needs.
 *
 * The contract is: a resource "exists" when the underlying table has at
 * least one row for this course. Empty tables (count === 0) → "no creado"
 * (red icon). Anything above zero → "creado" (green icon).
 *
 * This function never throws on non-numeric inputs — it coerces with
 * `Number()` first, which turns `undefined` / `null` into `NaN`, and then
 * the `> 0` comparison returns `false`. That means a missing aggregate
 * field defaults to "not created", which is the safe interpretation
 * (rather than pretending the resource exists).
 */
export function getCourseStatus(input: {
  topicNodeCount?: number | null;
  slideCount?: number | null;
}): CourseStatus {
  const topicNodeCount = Number(input.topicNodeCount ?? 0);
  const slideCount = Number(input.slideCount ?? 0);

  return {
    hasTree: topicNodeCount > 0,
    hasSlides: slideCount > 0,
    topicNodeCount,
    slideCount,
  };
}

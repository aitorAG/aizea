//
// getCourseStatus — pure function tests.
//
// The helper is the contract between the Prisma query and the
// CourseStatusIcons component. It must be deterministic and defensive
// against missing aggregate fields, because the dashboard server
// component constructs the input from a `_count` block that is
// optional in some query shapes (e.g. when a course is being created
// concurrently and the count is null).
//

import { describe, it, expect } from "vitest";
import { getCourseStatus } from "@/lib/utils/course-status";

describe("getCourseStatus", () => {
  it("returns hasTree=true / hasSlides=true when both counts are positive", () => {
    const status = getCourseStatus({ topicNodeCount: 5, slideCount: 12 });
    expect(status.hasTree).toBe(true);
    expect(status.hasSlides).toBe(true);
    expect(status.topicNodeCount).toBe(5);
    expect(status.slideCount).toBe(12);
  });

  it("returns hasTree=false when topicNodeCount is 0", () => {
    const status = getCourseStatus({ topicNodeCount: 0, slideCount: 3 });
    expect(status.hasTree).toBe(false);
    expect(status.hasSlides).toBe(true);
  });

  it("returns hasSlides=false when slideCount is 0", () => {
    const status = getCourseStatus({ topicNodeCount: 7, slideCount: 0 });
    expect(status.hasTree).toBe(true);
    expect(status.hasSlides).toBe(false);
  });

  it("returns both false when both counts are 0 (fresh course)", () => {
    const status = getCourseStatus({ topicNodeCount: 0, slideCount: 0 });
    expect(status.hasTree).toBe(false);
    expect(status.hasSlides).toBe(false);
  });

  it("treats undefined counts as 0 (safe default: 'not created')", () => {
    const status = getCourseStatus({});
    expect(status.hasTree).toBe(false);
    expect(status.hasSlides).toBe(false);
    expect(status.topicNodeCount).toBe(0);
    expect(status.slideCount).toBe(0);
  });

  it("treats null counts as 0 (Prisma aggregate with no rows)", () => {
    const status = getCourseStatus({ topicNodeCount: null, slideCount: null });
    expect(status.hasTree).toBe(false);
    expect(status.hasSlides).toBe(false);
  });

  it("does not throw on garbage inputs (NaN-safe comparison)", () => {
    // A count of NaN should default to "not created" rather than
    // propagating the NaN into the boolean (which would also be false
    // but could surprise callers that print the raw count).
    const status = getCourseStatus({
      topicNodeCount: Number("not a number") as unknown as number,
      slideCount: undefined,
    });
    expect(status.hasTree).toBe(false);
    expect(status.hasSlides).toBe(false);
    expect(Number.isNaN(status.topicNodeCount)).toBe(true);
  });
});

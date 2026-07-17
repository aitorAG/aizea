import { test, expect, describe } from "vitest";
import { BoxType } from "@/lib/types/slide";

describe("BoxType enum", () => {
  test("SCRIPT === \"script\"", () => {
    expect(BoxType.SCRIPT).toBe("script");
  });

  test("RELEVANCE === \"relevance\"", () => {
    expect(BoxType.RELEVANCE).toBe("relevance");
  });

  test("NARRATIVE === \"narrative\"", () => {
    expect(BoxType.NARRATIVE).toBe("narrative");
  });

  test("EXERCISE_1 === \"exercise1\"", () => {
    expect(BoxType.EXERCISE_1).toBe("exercise1");
  });

  test("EXERCISE_2 === \"exercise2\"", () => {
    expect(BoxType.EXERCISE_2).toBe("exercise2");
  });

  test("has exactly 5 values", () => {
    expect(Object.values(BoxType)).toHaveLength(5);
  });

  test("values match the expected set", () => {
    expect(Object.values(BoxType).sort()).toEqual(
      ["exercise1", "exercise2", "narrative", "relevance", "script"]
    );
  });
});

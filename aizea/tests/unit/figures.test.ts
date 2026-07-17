import { describe, it, expect } from "vitest";
import { extractFigureReferences } from "@/lib/figures";

describe("extractFigureReferences", () => {
  it("extracts a figure reference with caption", () => {
    const result = extractFigureReferences("Figura 10.5: algo");
    expect(result).toEqual([
      { caption: "Figura 10.5: algo", pageNum: null },
    ]);
  });

  it("returns an empty array when no figure references are present", () => {
    const result = extractFigureReferences(
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit."
    );
    expect(result).toEqual([]);
  });
});

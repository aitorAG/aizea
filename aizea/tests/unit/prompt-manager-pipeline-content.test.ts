import { describe, it, expect } from "vitest";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";

const sampleUnit = {
  id: "u-1",
  materialId: "m-1",
  content: "lorem ipsum",
  order: 0,
  pageStart: 1,
  pageEnd: 1,
  sectionRef: null,
  sectionPath: [],
  createdAt: "2026-01-01T00:00:00Z",
};

const sampleGroups = [
  {
    id: "g-1",
    name: "Thermodynamics",
    description: "Heat & energy",
    importance: 0.9,
    concepts: ["entropy"],
    sourceUnitIds: ["u-1"],
  },
];

describe("PromptManager — pipeline templates (real content)", () => {
  const manager = new PromptManager();

  it("extract-unit template mentions JSON and Spanish in the system prompt", () => {
    const { system } = manager.buildExtractUnitPrompt(sampleUnit);
    expect(system).toContain("JSON");
    expect(system.toLowerCase()).toContain("español");
  });

  it("integrate-concepts template mentions JSON and Spanish in the system prompt", () => {
    const { system } = manager.buildIntegrateConceptsPrompt([]);
    expect(system).toContain("JSON");
    expect(system.toLowerCase()).toContain("español");
  });

  it("build-tree template mentions JSON and Spanish in the system prompt", () => {
    const { system } = manager.buildBuildTreePrompt(sampleGroups);
    expect(system).toContain("JSON");
    expect(system.toLowerCase()).toContain("español");
  });

  it("extract-unit user prompt includes the unit content", () => {
    const { user } = manager.buildExtractUnitPrompt({
      ...sampleUnit,
      content: "DISTINCTIVE-CONTENT-MARKER",
    });
    expect(user).toContain("DISTINCTIVE-CONTENT-MARKER");
  });

  it("integrate-concepts user prompt includes the concepts (or their cluster)", () => {
    const { user } = manager.buildIntegrateConceptsPrompt([
      { name: "MARKER-ENTROPY", importance: 0.5 },
    ]);
    expect(user).toContain("MARKER-ENTROPY");
  });

  it("build-tree user prompt includes the group name", () => {
    const { user } = manager.buildBuildTreePrompt([
      {
        id: "g-x",
        name: "MARKER-PHYSICS",
        description: "x",
        importance: 0.5,
        concepts: [],
        sourceUnitIds: [],
      },
    ]);
    expect(user).toContain("MARKER-PHYSICS");
  });
});

import { describe, it, expect, vi } from "vitest";

// Mock only the templates so we test the wiring of PromptManager.
const { mockExtractTemplate, mockIntegrateTemplate, mockBuildTreeTemplate } =
  vi.hoisted(() => ({
    mockExtractTemplate: vi.fn(() => ({
      system: "EXTRACT-UNIT-SYSTEM",
      user: "EXTRACT-UNIT-USER",
    })),
    mockIntegrateTemplate: vi.fn(() => ({
      system: "INTEGRATE-SYSTEM",
      user: "INTEGRATE-USER",
    })),
    mockBuildTreeTemplate: vi.fn(() => ({
      system: "BUILD-TREE-SYSTEM",
      user: "BUILD-TREE-USER",
    })),
  }));

vi.mock("@/lib/domain/prompts/templates/extract-unit.template", () => ({
  buildExtractUnitTemplate: mockExtractTemplate,
}));
vi.mock("@/lib/domain/prompts/templates/integrate-concepts.template", () => ({
  buildIntegrateConceptsTemplate: mockIntegrateTemplate,
}));
vi.mock("@/lib/domain/prompts/templates/build-tree.template", () => ({
  buildBuildTreeTemplate: mockBuildTreeTemplate,
}));

import { PromptManager } from "@/lib/domain/prompts/PromptManager";

const sampleUnit = {
  id: "u-1",
  materialId: "m-1",
  content: "lorem ipsum",
  order: 0,
  pageStart: 1,
  pageEnd: 1,
  sectionRef: null,
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

describe("PromptManager — pipeline templates (wiring)", () => {
  const manager = new PromptManager();

  it("buildExtractUnitPrompt returns { system, user } with non-empty strings", () => {
    const result = manager.buildExtractUnitPrompt(sampleUnit);
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("buildExtractUnitPrompt delegates to the extract-unit template with the unit", () => {
    manager.buildExtractUnitPrompt(sampleUnit);
    expect(mockExtractTemplate).toHaveBeenCalledWith(sampleUnit);
  });

  it("buildIntegrateConceptsPrompt returns { system, user } with non-empty strings", () => {
    const result = manager.buildIntegrateConceptsPrompt([
      { name: "entropy", importance: 0.9 },
    ]);
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("buildIntegrateConceptsPrompt delegates to the integrate-concepts template with the list", () => {
    const concepts = [{ name: "x", importance: 0.5 }];
    manager.buildIntegrateConceptsPrompt(concepts);
    expect(mockIntegrateTemplate).toHaveBeenCalledWith(concepts);
  });

  it("buildBuildTreePrompt returns { system, user } with non-empty strings", () => {
    const result = manager.buildBuildTreePrompt(sampleGroups);
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.user.length).toBeGreaterThan(0);
  });

  it("buildBuildTreePrompt delegates to the build-tree template with the groups", () => {
    manager.buildBuildTreePrompt(sampleGroups);
    expect(mockBuildTreeTemplate).toHaveBeenCalledWith(sampleGroups);
  });
});

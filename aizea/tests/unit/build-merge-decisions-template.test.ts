import { describe, it, expect } from "vitest";
import {
  buildMergeDecisionsTemplate,
  type MergeDecisionInput,
  type MergeExistingNode,
} from "@/lib/domain/prompts/templates/build-merge-decisions.template";

const existing: MergeExistingNode[] = [
  { id: "n-1", name: "Termodinámica", depth: 0, parentId: null },
  { id: "n-2", name: "Calor", depth: 1, parentId: "n-1" },
];

const decisions: MergeDecisionInput[] = [
  { concept: "Entropía", suggestedAction: "child", targetId: "n-1", similarity: 0.78 },
  { concept: "Fotosíntesis", suggestedAction: "new", targetId: null, similarity: 0.12 },
];

describe("buildMergeDecisionsTemplate", () => {
  it("returns non-empty system and user strings", () => {
    const { system, user } = buildMergeDecisionsTemplate(decisions, existing);
    expect(system.length).toBeGreaterThan(0);
    expect(user.length).toBeGreaterThan(0);
  });

  it("instructs the LLM to return the { decisions: [...] } shape with action/parentRef", () => {
    const { system } = buildMergeDecisionsTemplate(decisions, existing);
    expect(system).toContain("decisions");
    expect(system).toContain("action");
    expect(system).toContain("parentRef");
    // The three allowed actions must be documented.
    expect(system).toContain("same");
    expect(system).toContain("child");
    expect(system).toContain("new");
  });

  it("embeds the existing tree nodes (ids + names) in the user prompt", () => {
    const { user } = buildMergeDecisionsTemplate(decisions, existing);
    expect(user).toContain("n-1");
    expect(user).toContain("Termodinámica");
    expect(user).toContain("n-2");
  });

  it("embeds each new concept with its suggested action and similarity", () => {
    const { user } = buildMergeDecisionsTemplate(decisions, existing);
    expect(user).toContain("Entropía");
    expect(user).toContain("child");
    expect(user).toContain("Fotosíntesis");
    // Similarity is rounded to 3 decimals.
    expect(user).toContain("0.78");
  });

  it("handles an empty existing tree (first material) without throwing", () => {
    const { user } = buildMergeDecisionsTemplate(decisions, []);
    expect(user).toContain("Entropía");
  });
});

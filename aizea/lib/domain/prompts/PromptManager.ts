import { buildOutlineTemplate } from "./templates/outline.template";
import { buildBoxesTemplate } from "./templates/boxes.template";
import { buildHtmlDesignTemplate } from "./templates/html-design.template";
import { buildExtractUnitTemplate } from "./templates/extract-unit.template";
import {
  buildIntegrateConceptsTemplate,
  type ConceptGroup,
} from "./templates/integrate-concepts.template";
import { buildBuildTreeTemplate } from "./templates/build-tree.template";
import { buildSplitSubcontentsTemplate } from "./templates/split-subcontents.template";
import {
  buildMergeDecisionsTemplate,
  type MergeDecisionInput,
  type MergeExistingNode,
} from "./templates/build-merge-decisions.template";
import type {
  Concept,
  SemanticUnit,
  TopicGroup,
  TopicNode,
} from "@/lib/types/pipeline";

export class PromptManager {
  buildOutlinePrompt(
    nodes: TopicNode[]
  ): { system: string; user: string } {
    return buildOutlineTemplate(nodes);
  }

  buildBoxesPrompt(
    slideTitle: string,
    slideDescription: string,
    sourceText: string,
    figureRefs: string[]
  ): { system: string; user: string } {
    return buildBoxesTemplate(slideTitle, slideDescription, sourceText, figureRefs);
  }

  buildHtmlDesignPrompt(
    title: string,
    description: string,
    script: string,
    relevance: string,
    narrative: string,
    designInstructions: string
  ): { system: string; user: string } {
    return buildHtmlDesignTemplate(
      title,
      description,
      script,
      relevance,
      narrative,
      designInstructions
    );
  }

  buildExtractUnitPrompt(unit: SemanticUnit): { system: string; user: string } {
    return buildExtractUnitTemplate(unit);
  }

  buildIntegrateConceptsPrompt(
    concepts: Concept[] | ConceptGroup[]
  ): { system: string; user: string } {
    return buildIntegrateConceptsTemplate(concepts);
  }

  buildBuildTreePrompt(groups: TopicGroup[]): { system: string; user: string } {
    return buildBuildTreeTemplate(groups);
  }

  /**
   * Prompt used by the Split action to ask the LLM to propose
   * sub-contents of a single node. The LLM returns 2-5
   * {name, summary} pairs that are turned into child TopicNodes.
   */
  buildSplitSubcontentsPrompt(
    nodeName: string,
    nodeSummary: string | null
  ): { system: string; user: string } {
    return buildSplitSubcontentsTemplate(nodeName, nodeSummary);
  }

  /**
   * PR4 — prompt used by IncrementalMerger to validate/adjust the local
   * cosine merge decisions for newly extracted concepts against the existing
   * tree. Returns { decisions: [{ concept, action, parentRef?, ... }] }.
   */
  buildMergeDecisionsPrompt(
    decisions: MergeDecisionInput[],
    existing: MergeExistingNode[]
  ): { system: string; user: string } {
    return buildMergeDecisionsTemplate(decisions, existing);
  }
}

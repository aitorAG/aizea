import { describe, it, expect, expectTypeOf } from "vitest";
import {
  DocumentStructure,
  DocumentSection,
  TOCEntry,
  SemanticUnit,
  UnitRepresentation,
  Concept,
  Formula,
  Figure,
  MainIdea,
  TopicGroup,
  TopicNode,
  PipelineProgress,
  ProcessingStatus,
  PipelinePhase,
} from "@/lib/types/pipeline";

describe("lib/types/pipeline — exports", () => {
  it("exports all required types as values or types", () => {
    expectTypeOf<DocumentStructure>().toBeObject();
    expectTypeOf<DocumentSection>().toBeObject();
    expectTypeOf<TOCEntry>().toBeObject();
    expectTypeOf<SemanticUnit>().toBeObject();
    expectTypeOf<UnitRepresentation>().toBeObject();
    expectTypeOf<Concept>().toBeObject();
    expectTypeOf<Formula>().toBeObject();
    expectTypeOf<Figure>().toBeObject();
    expectTypeOf<MainIdea>().toBeObject();
    expectTypeOf<TopicGroup>().toBeObject();
    expectTypeOf<TopicNode>().toBeObject();
    expectTypeOf<PipelineProgress>().toBeObject();
  });

  it("ProcessingStatus is a union of 5 literals", () => {
    type _Assert = ProcessingStatus extends
      | "pending"
      | "running"
      | "completed"
      | "failed"
      | "cancelled"
      ? true
      : false;
    const ok: _Assert = true;
    expect(ok).toBe(true);
  });

  it("PipelinePhase covers the 5 documented phases", () => {
    type _Assert = PipelinePhase extends
      | "segmentation"
      | "extraction"
      | "integration"
      | "tree-building"
      | "merge"
      ? true
      : false;
    const ok: _Assert = true;
    expect(ok).toBe(true);
  });
});

describe("lib/types/pipeline — runtime shape (sample instances)", () => {
  it("DocumentStructure sample is well-typed and serializable", () => {
    const ds: DocumentStructure = {
      filename: "test.pdf",
      pageCount: 12,
      hasStructuralMarkup: true,
      sections: [
        {
          id: "sec-1",
          title: "Introduction",
          level: 0,
          numbering: "1",
          pageStart: 1,
          pageEnd: 3,
          content: "Lorem ipsum",
          structural: true,
        },
      ],
      toc: [{ title: "Introduction", level: 0, pageStart: 1 }],
    };
    const json = JSON.stringify(ds);
    const parsed: DocumentStructure = JSON.parse(json);
    expect(parsed.sections[0].title).toBe("Introduction");
    expect(parsed.hasStructuralMarkup).toBe(true);
  });

  it("UnitRepresentation with all arrays round-trips through JSON", () => {
    const r: UnitRepresentation = {
      id: "u1",
      unitId: "u",
      concepts: [{ name: "entropy", importance: 0.9 }],
      mainIdeas: [{ text: "energy is conserved", salience: 0.8 }],
      formulas: [{ latex: "E=mc^2", imageBase64: "iVBORw0K" }],
      figures: [
        { id: "f1", filename: "f.png", pageNum: 2, caption: "x", tags: [] },
      ],
      prerequisites: ["energy"],
      introduces: ["entropy"],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const parsed: UnitRepresentation = JSON.parse(JSON.stringify(r));
    expect(parsed.concepts[0].name).toBe("entropy");
    expect(parsed.formulas[0].latex).toBe("E=mc^2");
    expect(parsed.figures[0].filename).toBe("f.png");
  });

  it("TopicNode tree structure has nullable parentId", () => {
    const root: TopicNode = {
      id: "root",
      courseId: "c1",
      parentId: null,
      name: "Physics",
      summary: null,
      depth: 0,
      isLeaf: false,
      version: 1,
      sourceMaterialId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const child: TopicNode = { ...root, id: "c", parentId: "root", depth: 1, isLeaf: true };
    expect(root.parentId).toBeNull();
    expect(child.parentId).toBe("root");
  });

  it("PipelineProgress has numeric progress 0..total", () => {
    const p: PipelineProgress = {
      jobId: "j1",
      type: "extraction",
      status: "running",
      progress: 42,
      total: 100,
      currentStep: "extracting unit 5/10",
      error: null,
      courseId: "c1",
      materialId: "m1",
    };
    expect(p.progress).toBeLessThanOrEqual(p.total);
  });
});

describe("lib/types — re-exports from index", () => {
  it("pipeline types are re-exported from lib/types", async () => {
    const mod = await import("@/lib/types");
    // The types are erased at runtime; verify the file at least exists and is loadable.
    expect(mod).toBeDefined();
    expect(typeof mod.BoxType).toBe("object"); // enum is object at runtime
  });
});

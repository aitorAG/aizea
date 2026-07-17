import { describe, it, expect } from "vitest";
import { PromptManager } from "@/lib/domain/prompts/PromptManager";
import {
  buildOutlinePrompt,
  buildBoxesPrompt,
  buildHtmlDesignPrompt,
} from "@/lib/prompts";
import type { TopicNode } from "@/lib/types/pipeline";

describe("PromptManager.buildOutlinePrompt", () => {
  const manager = new PromptManager();

  const sampleNodes: TopicNode[] = [
    {
      id: "n-1",
      courseId: "c-1",
      parentId: null,
      name: "Termodinámica",
      summary: "Estudio del calor y trabajo",
      depth: 0,
      isLeaf: false,
      version: 1,
      sourceMaterialId: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "n-2",
      courseId: "c-1",
      parentId: "n-1",
      name: "Primera ley",
      summary: "Conservación de energía",
      depth: 1,
      isLeaf: true,
      version: 1,
      sourceMaterialId: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ];

  it("produces a system prompt mentioning 'pedagógica' / 'orden'", () => {
    const { system } = manager.buildOutlinePrompt(sampleNodes);
    expect(system).toMatch(/pedag[oó]gic|orden/i);
  });

  it("embeds each node's id, name and summary in the user prompt", () => {
    const { user } = manager.buildOutlinePrompt(sampleNodes);
    expect(user).toContain("n-1");
    expect(user).toContain("Termodinámica");
    expect(user).toContain("n-2");
    expect(user).toContain("Primera ley");
  });

  it("exposes a top-level buildOutlinePrompt helper that returns the same shape", () => {
    const { system, user } = buildOutlinePrompt(sampleNodes);
    expect(system.length).toBeGreaterThan(0);
    expect(user.length).toBeGreaterThan(0);
  });
});

describe("PromptManager.buildBoxesPrompt", () => {
  const manager = new PromptManager();

  it("embeds all five BoxType keys and the figure hint when figureRefs is non-empty", () => {
    const { system } = manager.buildBoxesPrompt(
      "Título",
      "Descripción",
      "Texto fuente",
      ["Figura 1.1", "Figura 2.3"]
    );
    expect(system).toContain("script, relevance, narrative, exercise1, exercise2");
    expect(system).toContain("Figura 1.1, Figura 2.3");
  });

  it("omits the figure hint when figureRefs is empty", () => {
    const { system } = manager.buildBoxesPrompt("t", "d", "s", []);
    expect(system).not.toContain("Si hay referencias a figuras");
  });

  it("embeds the slide title and description in the user prompt", () => {
    const { user } = manager.buildBoxesPrompt("Mi título", "Mi descripción", "fuente", []);
    expect(user).toContain("Mi título");
    expect(user).toContain("Mi descripción");
  });
});

describe("PromptManager.buildHtmlDesignPrompt", () => {
  const manager = new PromptManager();

  it("includes the 1280x720 constraint in the system prompt", () => {
    const { system } = manager.buildHtmlDesignPrompt("T", "D", "S", "R", "N", "I");
    expect(system).toContain("1280x720px");
  });

  it("embeds all six input fields in the user prompt", () => {
    const { user } = manager.buildHtmlDesignPrompt(
      "T",
      "D",
      "S",
      "R",
      "N",
      "I"
    );
    expect(user).toContain("T");
    expect(user).toContain("D");
    expect(user).toContain("S");
    expect(user).toContain("R");
    expect(user).toContain("N");
    expect(user).toContain("I");
  });

  it("falls back to 'No disponible' placeholders for empty box content", () => {
    const { user } = manager.buildHtmlDesignPrompt("T", "D", "", "", "", "instr");
    expect(user).toContain("No disponible");
  });

  it("falls back to the default design instructions when none are provided", () => {
    const { user } = manager.buildHtmlDesignPrompt("T", "D", "S", "R", "N", "");
    expect(user).toContain(
      "Diseño académico limpio. Destaca fórmulas y conceptos clave."
    );
  });
});

describe("lib/prompts.ts wrapper (compatibility re-exports)", () => {
  it("re-exports buildOutlinePrompt from PromptManager", () => {
    const { system, user } = buildOutlinePrompt([
      {
        id: "n-1",
        courseId: "c-1",
        parentId: null,
        name: "Tema",
        summary: "s",
        depth: 0,
        isLeaf: true,
        version: 1,
        sourceMaterialId: null,
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      },
    ]);
    expect(system.length).toBeGreaterThan(0);
    expect(user).toContain("Tema");
  });

  it("re-exports buildBoxesPrompt from PromptManager", () => {
    const { system } = buildBoxesPrompt("t", "d", "s", []);
    expect(system).toContain("cinco cajas de contenido");
  });

  it("re-exports buildHtmlDesignPrompt from PromptManager", () => {
    const { system, user } = buildHtmlDesignPrompt("T", "D", "S", "R", "N", "I");
    expect(system).toContain("1280x720px");
    expect(user).toContain("T");
  });
});

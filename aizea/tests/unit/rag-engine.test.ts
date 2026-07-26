import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock config-service so EmbeddingService resolves the sentinel key without DB.
vi.mock("@/lib/config-service", () => ({
  getApiKey:  vi.fn(async () => "test-api-key"),
  getChatModel: vi.fn(async () => "deepseek/deepseek-chat"),
  getEmbedModel: vi.fn(async () => "openai/text-embedding-3-small"),
  getDoclingBaseUrl: vi.fn(async () => "http://127.0.0.1:5001"),
  getSettings: vi.fn(async () => ({
    apiKey: "test-api-key",
    chatModel: "deepseek/deepseek-chat",
    embedModel: "openai/text-embedding-3-small",
    doclingBaseUrl: "http://127.0.0.1:5001",
    fromDb: false,
  })),
  invalidateConfigCache: vi.fn(),
  _setCacheForTesting: vi.fn(),
  DEFAULT_CHAT_MODEL: "deepseek/deepseek-chat",
  DEFAULT_EMBED_MODEL: "openai/text-embedding-3-small",
  DEFAULT_DOCLING_BASE_URL: "http://127.0.0.1:5001",
  DEFAULT_API_KEY_FALLBACK: "test-api-key",
  CONFIG_CACHE_TTL_MS: 30_000,
}));

// Ensure OPENROUTER_API_KEY is set before dynamic imports of config
const ORIGINAL_API_KEY = process.env.OPENROUTER_API_KEY;

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  process.env.OPENROUTER_API_KEY = "test-api-key";
});

afterEach(() => {
  if (ORIGINAL_API_KEY === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = ORIGINAL_API_KEY;
  }
});

describe("TextChunker", () => {
  it("returns empty array for empty text", async () => {
    const { TextChunker } = await import("@/lib/domain/rag/TextChunker");
    expect(TextChunker.chunk("")).toEqual([]);
    expect(TextChunker.chunk("   ")).toEqual([]);
  });

  it("returns single chunk when text is shorter than chunk size", async () => {
    const { TextChunker } = await import("@/lib/domain/rag/TextChunker");
    const text = "Short text.";
    const chunks = TextChunker.chunk(text, { chunkSize: 500, overlap: 50 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("Short text.");
  });

  it("splits long text into multiple chunks with overlap", async () => {
    const { TextChunker } = await import("@/lib/domain/rag/TextChunker");
    // 500 tokens ~ 2000 chars; create text longer than that
    const word = "word ";
    const text = word.repeat(600);
    const chunks = TextChunker.chunk(text, { chunkSize: 500, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);

    // Verify overlap: consecutive chunks should share some words
    for (let i = 0; i < chunks.length - 1; i++) {
      const current = chunks[i];
      const next = chunks[i + 1];
      expect(next.length).toBeGreaterThan(0);
      // The next chunk should start with text that appears near the end of current
      const nextStart = next.split(" ").slice(0, 5).join(" ");
      expect(current).toContain(nextStart.trim());
    }
  });

  it("normalizes whitespace before chunking", async () => {
    const { TextChunker } = await import("@/lib/domain/rag/TextChunker");
    const text = "Line one.\n\nLine   two.\tTabbed.";
    const chunks = TextChunker.chunk(text, { chunkSize: 500, overlap: 50 });
    expect(chunks[0]).not.toContain("\n\n");
    expect(chunks[0]).not.toContain("\t");
  });
});

describe("EmbeddingService", () => {
  it("returns deterministic dummy vectors when API key is test key", async () => {
    const { EmbeddingService } = await import("@/lib/infrastructure/ai/embedding-service");
    const service = new EmbeddingService({ dimension: 8 });
    const vec1 = await service.embed("hello");
    const vec2 = await service.embed("hello");

    expect(vec1).toHaveLength(8);
    expect(vec1).toEqual(vec2);
  });

  it("returns different dummy vectors for different inputs", async () => {
    const { EmbeddingService } = await import("@/lib/infrastructure/ai/embedding-service");
    const service = new EmbeddingService({ dimension: 8 });
    const vec1 = await service.embed("hello");
    const vec2 = await service.embed("world");

    expect(vec1).not.toEqual(vec2);
  });

  it("embedBatch returns vectors for all inputs", async () => {
    const { EmbeddingService } = await import("@/lib/infrastructure/ai/embedding-service");
    const service = new EmbeddingService({ dimension: 16 });
    const vectors = await service.embedBatch(["a", "b", "c"]);

    expect(vectors).toHaveLength(3);
    vectors.forEach((v) => expect(v).toHaveLength(16));
  });
});

describe("RAGEngine", () => {
  const createdMaterialIds: string[] = [];
  const createdCourseIds: string[] = [];

  async function makeFixture(content: string) {
    const { db } = await import("@/lib/db");
    const course = await db.course.create({
      data: { name: `test-rag-course-${Date.now()}` },
    });
    createdCourseIds.push(course.id);

    const material = await db.material.create({
      data: {
        courseId: course.id,
        filename: "test.txt",
        content,
      },
    });
    createdMaterialIds.push(material.id);

    return { course, material };
  }

  afterEach(async () => {
    const { db } = await import("@/lib/db");
    for (const id of createdMaterialIds.splice(0)) {
      await db.textChunk.deleteMany({ where: { materialId: id } }).catch(() => {});
      await db.material.delete({ where: { id } }).catch(() => {});
    }
    for (const id of createdCourseIds.splice(0)) {
      await db.course.delete({ where: { id } }).catch(() => {});
    }
  });

  it("indexMaterial chunks, embeds, stores vectors and persists TextChunks", async () => {
    const { RAGEngine } = await import("@/lib/domain/rag/RAGEngine");
    const { db } = await import("@/lib/db");
    const { PrismaRagRepository } = await import("@/lib/infrastructure/persistence/prisma-rag.repository");

    const mockInsert = vi.fn().mockResolvedValue(undefined);
    const mockDeleteByMaterialId = vi.fn().mockResolvedValue(undefined);
    const mockSearch = vi.fn().mockResolvedValue([]);

    const mockVectorStore = {
      insert: mockInsert,
      deleteByMaterialId: mockDeleteByMaterialId,
      search: mockSearch,
    };

    const mockEmbed = vi.fn().mockImplementation((text: string) => {
      // Return a deterministic vector based on text length
      return Promise.resolve(new Array(8).fill(text.length));
    });
    const mockEmbedBatch = vi.fn().mockImplementation((texts: string[]) => {
      return Promise.resolve(texts.map((t) => new Array(8).fill(t.length)));
    });

    const mockEmbedder = {
      embed: mockEmbed,
      embedBatch: mockEmbedBatch,
    };

    // Integration: real Prisma repository against the test DB.
    const engine = new RAGEngine({
      embedder: mockEmbedder as unknown as import("@/lib/application/ports/embedding-provider.port").IEmbeddingProvider,
      vectorStore: mockVectorStore as unknown as import("@/lib/application/ports/vector-store.port").IVectorStore,
      repository: new PrismaRagRepository(),
    });

    // Content long enough to produce multiple chunks
    const content = "word ".repeat(600);
    const { material } = await makeFixture(content);

    await engine.indexMaterial(material.id);

    // Verify VectorStore received inserts
    expect(mockDeleteByMaterialId).toHaveBeenCalledWith(material.id);
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const insertedRecords = mockInsert.mock.calls[0][0];
    expect(insertedRecords.length).toBeGreaterThan(0);
    expect(insertedRecords[0]).toHaveProperty("id");
    expect(insertedRecords[0]).toHaveProperty("vector");
    expect(insertedRecords[0]).toHaveProperty("metadata.materialId", material.id);

    // Verify DB records
    const dbChunks = await db.textChunk.findMany({
      where: { materialId: material.id },
      orderBy: { chunkIndex: "asc" },
    });
    expect(dbChunks.length).toBeGreaterThan(0);
    expect(dbChunks[0].content.length).toBeGreaterThan(0);
    expect(dbChunks[0].embedding).toBeTruthy();
    expect(dbChunks[0].tokenCount).toBeGreaterThan(0);
  });

  it("searchRelevant returns chunks ordered by relevance", async () => {
    const { RAGEngine } = await import("@/lib/domain/rag/RAGEngine");

    const mockSearch = vi.fn().mockResolvedValue([
      { id: "chunk-1", metadata: { materialId: "mat-1", chunkIndex: 0, content: "first" }, score: 0.1 },
      { id: "chunk-2", metadata: { materialId: "mat-1", chunkIndex: 1, content: "second" }, score: 0.2 },
    ]);

    const mockVectorStore = {
      insert: vi.fn().mockResolvedValue(undefined),
      deleteByMaterialId: vi.fn().mockResolvedValue(undefined),
      search: mockSearch,
    };

    const mockEmbedder = {
      embed: vi.fn().mockResolvedValue(new Array(8).fill(1)),
      embedBatch: vi.fn().mockResolvedValue([]),
    };

    const engine = new RAGEngine({
      embedder: mockEmbedder as unknown as import("@/lib/application/ports/embedding-provider.port").IEmbeddingProvider,
      vectorStore: mockVectorStore as unknown as import("@/lib/application/ports/vector-store.port").IVectorStore,
    });

    const results = await engine.searchRelevant("query", "mat-1", 2);

    expect(mockEmbedder.embed).toHaveBeenCalledWith("query");
    expect(mockSearch).toHaveBeenCalledWith(expect.any(Array), 2);
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      id: "chunk-1",
      content: "first",
      chunkIndex: 0,
      score: 0.1,
    });
  });

  it("searchRelevant filters out chunks from other materials", async () => {
    const { RAGEngine } = await import("@/lib/domain/rag/RAGEngine");

    const mockSearch = vi.fn().mockResolvedValue([
      { id: "chunk-a", metadata: { materialId: "mat-1", chunkIndex: 0, content: "relevant" }, score: 0.1 },
      { id: "chunk-b", metadata: { materialId: "mat-2", chunkIndex: 0, content: "other" }, score: 0.05 },
    ]);

    const mockVectorStore = {
      insert: vi.fn().mockResolvedValue(undefined),
      deleteByMaterialId: vi.fn().mockResolvedValue(undefined),
      search: mockSearch,
    };

    const mockEmbedder = {
      embed: vi.fn().mockResolvedValue(new Array(8).fill(1)),
      embedBatch: vi.fn().mockResolvedValue([]),
    };

    const engine = new RAGEngine({
      embedder: mockEmbedder as unknown as import("@/lib/application/ports/embedding-provider.port").IEmbeddingProvider,
      vectorStore: mockVectorStore as unknown as import("@/lib/application/ports/vector-store.port").IVectorStore,
    });

    const results = await engine.searchRelevant("query", "mat-1", 5);

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("relevant");
  });

  it("indexMaterial throws when material is not found", async () => {
    const { RAGEngine } = await import("@/lib/domain/rag/RAGEngine");
    const { PrismaRagRepository } = await import("@/lib/infrastructure/persistence/prisma-rag.repository");

    const engine = new RAGEngine({
      embedder: {
        embed: vi.fn().mockResolvedValue([]),
        embedBatch: vi.fn().mockResolvedValue([]),
      } as unknown as import("@/lib/application/ports/embedding-provider.port").IEmbeddingProvider,
      vectorStore: {
        insert: vi.fn().mockResolvedValue(undefined),
        deleteByMaterialId: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
      } as unknown as import("@/lib/application/ports/vector-store.port").IVectorStore,
      repository: new PrismaRagRepository(),
    });

    await expect(engine.indexMaterial("non-existent-id")).rejects.toThrow(
      "Material not found"
    );
  });

  it("indexMaterial does nothing when material content is empty", async () => {
    const { RAGEngine } = await import("@/lib/domain/rag/RAGEngine");
    const { db } = await import("@/lib/db");
    const { PrismaRagRepository } = await import("@/lib/infrastructure/persistence/prisma-rag.repository");

    const mockInsert = vi.fn().mockResolvedValue(undefined);
    const mockEmbedBatch = vi.fn().mockResolvedValue([]);

    const engine = new RAGEngine({
      embedder: {
        embed: vi.fn().mockResolvedValue([]),
        embedBatch: mockEmbedBatch,
      } as unknown as import("@/lib/application/ports/embedding-provider.port").IEmbeddingProvider,
      vectorStore: {
        insert: mockInsert,
        deleteByMaterialId: vi.fn().mockResolvedValue(undefined),
        search: vi.fn().mockResolvedValue([]),
      } as unknown as import("@/lib/application/ports/vector-store.port").IVectorStore,
      repository: new PrismaRagRepository(),
    });

    const { material } = await makeFixture("   ");
    await engine.indexMaterial(material.id);

    expect(mockEmbedBatch).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();

    const chunks = await db.textChunk.findMany({ where: { materialId: material.id } });
    expect(chunks).toHaveLength(0);
  });
});

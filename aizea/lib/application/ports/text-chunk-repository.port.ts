// ITextChunkRepository — port for TextChunk persistence.

export interface TextChunkRow {
  id: string;
  materialId: string;
  chunkIndex: number;
  content: string;
  embedding: string | null;
  tokenCount: number;
}

export interface ITextChunkRepository {
  findByMaterialId(materialId: string): Promise<TextChunkRow[]>;
  createMany(chunks: Omit<TextChunkRow, "id">[]): Promise<void>;
  deleteByMaterialId(materialId: string): Promise<void>;
  /** Atomically replaces chunks for a material (deleteMany + createMany in $transaction). */
  replaceForMaterial(materialId: string, chunks: Omit<TextChunkRow, "id">[]): Promise<void>;
}

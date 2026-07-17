export interface ChunkOptions {
  chunkSize: number;
  overlap: number;
}

export class TextChunker {
  /**
   * Split text into chunks of approximately `chunkSize` tokens with `overlap` tokens
   * of overlap between consecutive chunks.
   *
   * We approximate 1 token ≈ 4 characters for Latin text.
   */
  static chunk(text: string, options: ChunkOptions = { chunkSize: 500, overlap: 50 }): string[] {
    const { chunkSize, overlap } = options;
    const charsPerToken = 4;
    const chunkChars = chunkSize * charsPerToken;
    const overlapChars = overlap * charsPerToken;

    const normalized = text.trim().replace(/\s+/g, " ");
    if (normalized.length === 0) {
      return [];
    }

    if (normalized.length <= chunkChars) {
      return [normalized];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < normalized.length) {
      const end = Math.min(start + chunkChars, normalized.length);
      let slice = normalized.slice(start, end);

      // If we're not at the end, try to break at a word boundary
      if (end < normalized.length) {
        const lastSpace = slice.lastIndexOf(" ");
        if (lastSpace > 0) {
          slice = slice.slice(0, lastSpace);
        }
      }

      chunks.push(slice.trim());

      const advance = Math.max(slice.length - overlapChars, 1);
      start += advance;
    }

    return chunks;
  }
}

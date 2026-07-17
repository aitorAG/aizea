export function extractFigureReferences(
  text: string
): Array<{ caption: string; pageNum: number | null }> {
  const results: Array<{ caption: string; pageNum: number | null }> = [];
  const seen = new Set<string>();

  // Match patterns like "Figura 1.2", "Figura 3", "Figure 2.1", etc.
  // Followed by a caption until end of line or sentence.
  const regex = /(?:Figura|Figure)\s+(\d+(?:\.\d+)?)[.:]?\s*([^\n.]*)/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const figureNum = match[1];
    const captionText = match[2].trim();
    const caption = captionText
      ? `Figura ${figureNum}: ${captionText}`
      : `Figura ${figureNum}`;

    if (!seen.has(caption)) {
      seen.add(caption);
      results.push({ caption, pageNum: null });
    }
  }

  return results;
}

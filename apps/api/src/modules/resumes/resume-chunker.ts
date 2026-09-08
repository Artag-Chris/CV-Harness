/**
 * Trocea el texto de una hoja de vida en fragmentos para embedding.
 * Agrupa párrafos consecutivos hasta ~maxChars, con solape de ~overlap chars.
 */
export function chunkResumeText(
  text: string,
  maxChars = 1200,
  overlap = 120,
): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim().length > 0) chunks.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      // Párrafo muy largo: corte por oraciones.
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      let bucket = '';
      for (const sentence of sentences) {
        if (bucket.length + sentence.length > maxChars && bucket.length > 0) {
          chunks.push(bucket.trim());
          bucket = bucket.slice(-overlap);
        }
        bucket += `${sentence} `;
      }
      if (bucket.trim().length > 0) chunks.push(bucket.trim());
      continue;
    }

    const candidate = current.length === 0 ? paragraph : `${current}\n${paragraph}`;
    if (candidate.length > maxChars) {
      if (current.length > 0) chunks.push(current.trim());
      current = paragraph.slice(0, Math.min(paragraph.length, overlap)); // arrastre mínimo
    } else {
      current = candidate;
    }
  }
  pushCurrent();
  return chunks;
}

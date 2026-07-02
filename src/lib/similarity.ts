/**
 * Term-frequency cosine similarity between two texts.
 * Used for the anti-fraud check: a revised JD must stay >85% similar
 * to the original JD of the same job_id.
 */

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "are", "was", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "should", "could", "you", "your", "we", "our", "they", "their",
  "it", "its", "this", "that", "these", "those", "not", "no", "if", "then",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s+#.]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

export function cosineSimilarity(textA: string, textB: string): number {
  const tfA = termFrequencies(tokenize(textA));
  const tfB = termFrequencies(tokenize(textB));
  if (tfA.size === 0 || tfB.size === 0) return 0;

  let dot = 0;
  for (const [term, countA] of tfA) {
    const countB = tfB.get(term);
    if (countB) dot += countA * countB;
  }

  let normA = 0;
  for (const c of tfA.values()) normA += c * c;
  let normB = 0;
  for (const c of tfB.values()) normB += c * c;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

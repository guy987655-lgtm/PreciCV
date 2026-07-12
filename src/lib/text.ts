/**
 * Shared text-normalization helpers. Used both server-side (CV repair, LLM
 * prompts) and client-side (questionnaire de-duplication). Kept dependency-free
 * so it imports cleanly into route handlers, the LLM engine and React.
 */

/** Lowercase, collapse every non-alphanumeric run to a single space, trim. */
export function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Loose match: equal, or one string contains the other (after norm). */
export function looseMatch(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Token-set overlap (Jaccard) on normalized words — robust to reordering and
 * minor wording changes ("Do you use SQL?" vs "SQL — do you use it daily?").
 */
export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(norm(a).split(" ").filter(Boolean));
  const tb = new Set(norm(b).split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * True when two questions are effectively the same. Combines exact/substring
 * matching with token overlap so near-duplicate phrasings from the LLM are
 * caught (the funnel dedup that exact-text matching used to miss).
 */
export function isSimilarQuestion(a: string, b: string, threshold = 0.6): boolean {
  if (looseMatch(a, b)) return true;
  return tokenOverlap(a, b) >= threshold;
}

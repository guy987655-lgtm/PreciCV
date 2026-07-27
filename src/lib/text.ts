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
function tokenOverlap(a: string, b: string): number {
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

/** Boilerplate that reads like a company name but never is one. */
const NOT_A_COMPANY =
  /^(us|we|our|the (team|company|role|position|client)|you|your|a |an |this )/i;

/**
 * Best-effort hiring-company guess straight from the JD text — the fallback
 * for when the LLM greeting call (which normally supplies it) failed or
 * returned nothing. Deliberately conservative: a wrong company name on a
 * History row is worse than the neutral date fallback, so anything that
 * doesn't look like a proper noun is rejected.
 */
export function companyFromJd(jdText: string): string {
  const head = jdText.slice(0, 1500);
  const patterns = [
    /\b(?:join|about)\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})/,
    /\bat\s+([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})\s*,?\s+(?:we|you|our)\b/,
    /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,2})\s+is\s+(?:looking|hiring|seeking)\b/,
    /\bcompany\s*:\s*([^\n]{2,40})/i,
  ];
  for (const re of patterns) {
    const hit = re.exec(head)?.[1]?.trim().replace(/[.,;:]+$/, "");
    if (hit && hit.length >= 2 && hit.length <= 40 && !NOT_A_COMPANY.test(hit)) {
      return hit;
    }
  }
  return "";
}

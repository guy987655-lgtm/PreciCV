import { CvTemplate, CV_TEMPLATES } from "./types";

/**
 * Catalog + layout metadata for the CV design gallery. Single source of truth
 * shared by both surfaces (the anonymous funnel and the paid workspace) so the
 * 3-row catalog and the split-view constraints behave identically everywhere.
 *
 * - `category` groups designs into the two visible style rows.
 * - `splitMode` constrains the split/full toggle per design:
 *     "both"   → user may toggle split view on or off (default);
 *     "never"  → the design only renders full-page (toggle hidden/forced off);
 *     "always" → the design only renders split (toggle hidden/forced on).
 * - `roleTags` drive the JD-based "Recommended for you" row.
 */
export type TemplateCategory = "classic" | "modern";
export type SplitMode = "both" | "never" | "always";

export type TemplateInfo = {
  category: TemplateCategory;
  splitMode: SplitMode;
  roleTags: RoleTag[];
};

export type RoleTag =
  | "engineering"
  | "data"
  | "design"
  | "leadership"
  | "business"
  | "academic";

export const CV_TEMPLATE_INFO: Record<CvTemplate, TemplateInfo> = {
  // ----- Classic / Traditional -----
  classic: { category: "classic", splitMode: "both", roleTags: ["business", "leadership"] },
  compact: { category: "classic", splitMode: "both", roleTags: ["business", "academic"] },
  executive: { category: "classic", splitMode: "both", roleTags: ["leadership", "business"] },
  elegant: { category: "classic", splitMode: "both", roleTags: ["leadership", "design"] },
  ledger: { category: "classic", splitMode: "both", roleTags: ["business", "data"] },
  masthead: { category: "classic", splitMode: "both", roleTags: ["leadership", "business"] },
  columnrule: { category: "classic", splitMode: "always", roleTags: ["business", "academic"] },
  onyx: { category: "classic", splitMode: "both", roleTags: ["leadership", "business"] },

  // ----- Modern / Creative -----
  modern: { category: "modern", splitMode: "both", roleTags: ["business", "design"] },
  minimal: { category: "modern", splitMode: "both", roleTags: ["design", "engineering"] },
  contemporary: { category: "modern", splitMode: "both", roleTags: ["design", "business"] },
  technical: { category: "modern", splitMode: "both", roleTags: ["engineering", "data"] },
  midnight: { category: "modern", splitMode: "both", roleTags: ["engineering", "design"] },
  index: { category: "modern", splitMode: "both", roleTags: ["design", "academic"] },
  marginalia: { category: "modern", splitMode: "both", roleTags: ["design", "academic"] },
  panel: { category: "modern", splitMode: "both", roleTags: ["design", "business"] },
  rail: { category: "modern", splitMode: "both", roleTags: ["design", "engineering"] },
  specsheet: { category: "modern", splitMode: "both", roleTags: ["engineering", "data"] },
  grid: { category: "modern", splitMode: "never", roleTags: ["engineering", "data"] },
  timeline: { category: "modern", splitMode: "never", roleTags: ["design", "business"] },
  mono: { category: "modern", splitMode: "never", roleTags: ["engineering", "data"] },
};

/** Whether the split toggle should be shown for this template. */
export function canToggleSplit(t: CvTemplate): boolean {
  return CV_TEMPLATE_INFO[t].splitMode === "both";
}

/**
 * The split value a template must render at, ignoring the user's toggle.
 * Returns null when the user is free to choose (splitMode "both").
 */
export function forcedSplit(t: CvTemplate): boolean | null {
  const mode = CV_TEMPLATE_INFO[t].splitMode;
  if (mode === "always") return true;
  if (mode === "never") return false;
  return null;
}

/** Resolve the effective split value for a template given the user's toggle. */
export function effectiveSplit(t: CvTemplate, userSplit: boolean): boolean {
  const forced = forcedSplit(t);
  return forced === null ? userSplit : forced;
}

/** Keyword → role tag map for the "Recommended for you" catalog row. */
const ROLE_KEYWORDS: Record<RoleTag, string[]> = {
  engineering: [
    "engineer", "developer", "software", "backend", "frontend", "full stack",
    "fullstack", "devops", "sre", "programming", "coding", "api", "cloud",
    "kubernetes", "docker", "microservices", "architect",
  ],
  data: [
    "data", "analyst", "analytics", "machine learning", "ml", "ai",
    "scientist", "sql", "python", "statistics", "bi", "etl", "warehouse",
  ],
  design: [
    "design", "designer", "ux", "ui", "product design", "creative", "brand",
    "visual", "figma", "graphic", "art director",
  ],
  leadership: [
    "manager", "director", "head of", "lead", "vp", "chief", "executive",
    "cto", "ceo", "coo", "founder", "leadership", "strategy",
  ],
  business: [
    "marketing", "sales", "account", "business", "operations", "finance",
    "consultant", "project manager", "product manager", "growth", "revenue",
  ],
  academic: [
    "research", "phd", "professor", "lecturer", "scientist", "academic",
    "publication", "grant", "university", "postdoc",
  ],
};

/**
 * Lightweight, no-LLM recommendation: score each role tag by keyword hits in
 * the JD, then return the templates whose tags match the strongest signals,
 * ordered best-first. Falls back to a sensible default set when the JD is thin.
 */
export function recommendTemplates(jdText: string, limit = 4): CvTemplate[] {
  const text = ` ${jdText.toLowerCase()} `;
  const scores = {} as Record<RoleTag, number>;
  for (const tag of Object.keys(ROLE_KEYWORDS) as RoleTag[]) {
    scores[tag] = ROLE_KEYWORDS[tag].reduce(
      (n, kw) => (text.includes(kw) ? n + 1 : n),
      0
    );
  }
  const ranked = (Object.keys(scores) as RoleTag[])
    .filter((t) => scores[t] > 0)
    .sort((a, b) => scores[b] - scores[a]);

  if (ranked.length === 0) {
    // Neutral default: a clean spread across both style families.
    const fallback: CvTemplate[] = ["classic", "modern", "technical", "elegant"];
    return fallback.slice(0, limit);
  }

  const seen = new Set<CvTemplate>();
  const out: CvTemplate[] = [];
  for (const tag of ranked) {
    for (const t of CV_TEMPLATES) {
      if (out.length >= limit) break;
      if (seen.has(t)) continue;
      if (CV_TEMPLATE_INFO[t].roleTags.includes(tag)) {
        seen.add(t);
        out.push(t);
      }
    }
  }
  // Top up if the matched tags didn't yield enough distinct templates.
  for (const t of CV_TEMPLATES) {
    if (out.length >= limit) break;
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, limit);
}

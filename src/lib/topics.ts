/**
 * Question categories for My Card's filter chips.
 *
 * Topics come from three places and none of them covers everything:
 *   - MCQ questions carry an LLM-assigned `topic` (McqQuestionSchema).
 *   - Open questions only started carrying one recently, so every answer
 *     given before that has none.
 *   - Account-restored answers only carry one if they were written after
 *     `topic` was added to profile_answers.payload.
 *
 * `inferTopic` is the floor under all three: a keyword pass over the question
 * text so legacy rows still land in a sensible bucket instead of piling up
 * under "General". Dependency-free, same as text.ts, so it imports cleanly
 * into both route handlers and React.
 */

import { norm } from "./text";

/** Shown when nothing matches — also the bucket for genuinely generic questions. */
export const GENERAL_TOPIC = "General";

/** Overflow bucket when there are more distinct topics than chips we show. */
export const OTHER_TOPIC = "Other";

/**
 * Max filter chips before the tail folds into "Other" — the "All" chip is
 * extra. Matches MAX_MCQ_SEGMENTS in funnel.ts, which caps the questionnaire's
 * own topic navigation, so the two surfaces fragment at the same point.
 */
export const MAX_TOPIC_CHIPS = 6;

/**
 * Keyword → canonical topic. Ordered: the first table entry with a hit wins,
 * so put the specific ones above the generic ones ("dashboard" must beat
 * "data"). Keywords are matched against `norm()`ed text, so they must be
 * lowercase and space-separated.
 */
const TOPIC_KEYWORDS: { topic: string; keywords: string[] }[] = [
  {
    topic: "AI & ML",
    keywords: [
      "ai", "ml", "machine learning", "deep learning", "llm", "gpt", "genai",
      "generative", "model training", "neural", "nlp", "prompt", "rag",
      "tensorflow", "pytorch", "scikit", "inference", "embedding",
    ],
  },
  {
    topic: "Visualization",
    keywords: [
      "visualization", "visualisation", "dashboard", "tableau", "looker",
      "power bi", "powerbi", "chart", "charts", "graphs", "reporting",
      "d3", "plotly", "grafana", "storytelling",
    ],
  },
  {
    topic: "Testing & QA",
    keywords: [
      "testing", "test", "tests", "qa", "quality assurance", "unit test",
      "e2e", "end to end", "automation", "selenium", "cypress", "playwright",
      "jest", "pytest", "regression", "bug", "debugging", "ab test",
      "a b test", "experiment",
    ],
  },
  {
    topic: "Data & SQL",
    keywords: [
      "sql", "data", "database", "query", "queries", "etl", "elt",
      "warehouse", "snowflake", "bigquery", "redshift", "postgres", "mysql",
      "spark", "airflow", "dbt", "pipeline", "analytics", "analysis",
      "statistics", "modeling", "modelling",
    ],
  },
  {
    topic: "Engineering",
    keywords: [
      "code", "coding", "python", "javascript", "typescript", "java", "react",
      "node", "api", "backend", "frontend", "architecture", "microservice",
      "docker", "kubernetes", "aws", "azure", "gcp", "cloud", "devops",
      "ci cd", "git", "deployment", "infrastructure", "scalability",
    ],
  },
  {
    topic: "Leadership",
    keywords: [
      "lead", "leader", "leadership", "manage", "managed", "management",
      "mentor", "mentoring", "team", "stakeholder", "hiring", "report",
      "reports", "cross functional", "collaborat", "conflict", "influence",
      "ownership",
    ],
  },
  {
    topic: "Product & Business",
    keywords: [
      "product", "business", "roadmap", "strategy", "customer", "client",
      "user", "market", "revenue", "kpi", "okr", "growth", "impact", "roi",
      "prioriti", "requirement", "scope",
    ],
  },
  {
    topic: "Experience",
    keywords: [
      "year", "years", "role", "company", "companies", "job", "position",
      "worked", "work", "career", "industry", "employment", "tenure",
      "responsib", "achievement", "project",
    ],
  },
  {
    topic: "Education",
    keywords: [
      "degree", "education", "university", "college", "bachelor", "master",
      "phd", "certification", "certified", "course", "training", "bootcamp",
      "studied",
    ],
  },
  {
    topic: "Availability",
    keywords: [
      "salary", "compensation", "relocat", "remote", "hybrid", "onsite",
      "notice period", "availab", "start date", "visa", "sponsor", "travel",
      "language", "willing",
    ],
  },
];

/**
 * Best-effort category for a question with no stored topic. Returns
 * GENERAL_TOPIC when nothing matches — a wrong guess is worse than a neutral
 * bucket, so single generic words like "the" or "how" never match anything.
 */
export function inferTopic(question: string): string {
  // Pad so `includes` can require whole-word boundaries for short keywords.
  const text = ` ${norm(question)} `;
  for (const { topic, keywords } of TOPIC_KEYWORDS) {
    for (const kw of keywords) {
      // Short keywords ("ai", "ml", "qa") must match a whole word or they hit
      // inside unrelated ones ("ai" in "email", "ml" in "html").
      const hit =
        kw.length <= 3 ? text.includes(` ${kw} `) : text.includes(kw);
      if (hit) return topic;
    }
  }
  return GENERAL_TOPIC;
}

/**
 * The topic to show for a row: what the question actually carries, else the
 * keyword guess. Callers pass the stored topic (which may be "" for legacy
 * rows) and the question text.
 */
export function resolveTopic(stored: string | undefined, question: string): string {
  const t = stored?.trim();
  if (t) return t;
  return inferTopic(question);
}

export type TopicBucket = { topic: string; count: number };

/**
 * Filter chips for a set of resolved topics: most-populated first, capped at
 * MAX_TOPIC_CHIPS with the tail folded into "Other". "General" is always
 * sorted last among the kept chips — it is the least useful place to look.
 */
export function buildTopicBuckets(topics: string[]): TopicBucket[] {
  const counts = new Map<string, number>();
  for (const t of topics) {
    const key = t.trim() || GENERAL_TOPIC;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const ranked = [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => {
      const aGeneric = a.topic === GENERAL_TOPIC;
      const bGeneric = b.topic === GENERAL_TOPIC;
      if (aGeneric !== bGeneric) return aGeneric ? 1 : -1;
      if (b.count !== a.count) return b.count - a.count;
      return a.topic.localeCompare(b.topic);
    });

  if (ranked.length <= MAX_TOPIC_CHIPS) return ranked;

  const kept = ranked.slice(0, MAX_TOPIC_CHIPS - 1);
  const rest = ranked.slice(MAX_TOPIC_CHIPS - 1);
  return [
    ...kept,
    { topic: OTHER_TOPIC, count: rest.reduce((n, r) => n + r.count, 0) },
  ];
}

/**
 * Whether a row's resolved topic belongs to the selected chip. "Other" is
 * virtual — it matches anything that didn't earn a chip of its own.
 */
export function matchesTopic(
  rowTopic: string,
  selected: string,
  buckets: TopicBucket[]
): boolean {
  if (!selected) return true; // "All"
  const t = rowTopic.trim() || GENERAL_TOPIC;
  if (selected === OTHER_TOPIC) {
    return !buckets.some((b) => b.topic !== OTHER_TOPIC && b.topic === t);
  }
  return t === selected;
}

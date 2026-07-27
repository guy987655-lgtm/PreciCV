/**
 * Replaying a user's past answers onto a NEW job's questions.
 *
 * The LLM mints fresh question ids and rewords every flow, so ids never match
 * and exact text rarely does — matching is semantic (`isSimilarQuestion`).
 * This module is deliberately React-free and storage-free so the browser
 * (localStorage history, see answer-cache.ts) and the server
 * (profile_answers, see /api/answers/match) run the exact same matching
 * rules; two implementations would drift and users would be asked things the
 * other half of the system considered known.
 */
import { McqAnswer, OTHER_OPTION } from "./funnel";
import { McqQuestionnaire, Questionnaire } from "./types";
import { isSimilarQuestion } from "./text";

type McqQuestion = McqQuestionnaire["questions"][number];

/** One remembered answer, whatever storage it came out of. */
export type StoredAnswer = {
  question: string;
  /** Readable form — what the tailoring prompt consumes. */
  answer: string;
  kind: "mcq" | "open";
  /** MCQ only: the picks as stored, in click order. */
  selected?: string[];
  /** MCQ only: free text behind the "Other…" choice. */
  other?: string;
  /** Newest wins when several answers match one question. */
  updatedAt?: number;
};

/** What a match run found, keyed by the NEW questions' ids. */
export type MatchedAnswers = {
  mcqAnswers: Record<string, McqAnswer>;
  answers: Record<string, string>;
  /** Ids answered from memory — these are not asked again. */
  knownIds: string[];
};

export const EMPTY_MATCH: MatchedAnswers = {
  mcqAnswers: {},
  answers: {},
  knownIds: [],
};

/**
 * Adapts a remembered MCQ answer to a new question's option set. Returns null
 * when the options are incompatible (a documented edge case — no auto-fill
 * then), so we never inject an option the new question can't render.
 */
function adaptMcqAnswer(
  cached: McqAnswer,
  target: McqQuestion
): McqAnswer | null {
  const allowed = new Set(target.options);
  const selected = (cached.selected ?? []).filter(
    (o) => o === OTHER_OPTION || allowed.has(o)
  );
  if (selected.length === 0) return null;
  // A single-select question can't carry multiple picks — keep the top choice.
  const trimmed =
    target.selectType === "single" ? selected.slice(0, 1) : selected;
  const hasOther = trimmed.includes(OTHER_OPTION);
  if (hasOther && !(cached.other ?? "").trim()) return null;
  return { selected: trimmed, ...(hasOther ? { other: cached.other } : {}) };
}

/**
 * Matches a new flow's questions against remembered answers. `sources` must
 * be newest-first: the first semantic hit wins, so the most recent answer is
 * the one replayed.
 */
export function matchAnswers(
  sources: StoredAnswer[],
  mcq: McqQuestionnaire | null,
  questionnaire: Questionnaire | null
): MatchedAnswers {
  const out: MatchedAnswers = { mcqAnswers: {}, answers: {}, knownIds: [] };
  const mcqSources = sources.filter((s) => s.kind === "mcq");
  const openSources = sources.filter((s) => s.kind === "open");

  for (const q of mcq?.questions ?? []) {
    const hit = mcqSources.find((s) => isSimilarQuestion(q.question, s.question));
    if (!hit) continue;
    const adapted = adaptMcqAnswer(
      { selected: hit.selected ?? [], other: hit.other },
      q
    );
    if (!adapted) continue;
    out.mcqAnswers[q.id] = adapted;
    out.knownIds.push(q.id);
  }

  for (const q of questionnaire?.questions ?? []) {
    const hit = openSources.find((s) =>
      isSimilarQuestion(q.question, s.question)
    );
    if (!hit?.answer.trim()) continue;
    out.answers[q.id] = hit.answer.trim();
    out.knownIds.push(q.id);
  }

  return out;
}

/** Merges two match results; `primary` wins on conflicts. */
export function mergeMatches(
  primary: MatchedAnswers,
  secondary: MatchedAnswers
): MatchedAnswers {
  const mcqAnswers = { ...secondary.mcqAnswers, ...primary.mcqAnswers };
  const answers = { ...secondary.answers, ...primary.answers };
  return {
    mcqAnswers,
    answers,
    knownIds: [...new Set([...Object.keys(mcqAnswers), ...Object.keys(answers)])],
  };
}


/**
 * Cross-flow question caching (PRD Topic 1) — client-side only.
 *
 * Users apply to many jobs and get asked semantically equivalent screening
 * questions each time. Rather than a server table, we mine the answers the user
 * already gave in *recent* flows (localStorage history + the active flow) and
 * auto-fill matching questions in a brand-new flow.
 *
 * Matching is semantic, reusing `isSimilarQuestion` (token-overlap), because the
 * LLM mints fresh question ids/wording every flow — ids never match. A 14-day
 * TTL is a simple `savedAt` timestamp filter; nothing is deleted.
 */
import {
  FunnelState,
  McqAnswer,
  OTHER_OPTION,
  isMcqAnswered,
  loadFunnel,
  loadHistory,
} from "./funnel";
import { McqQuestionnaire, Questionnaire } from "./types";
import { isSimilarQuestion } from "./text";

/** Answers older than this are ignored (PRD 1.4 — "within the last 14 days"). */
export const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type CachedAnswers = {
  mcqAnswers: Record<string, McqAnswer>;
  answers: Record<string, string>;
  autoFilledIds: string[];
};

type McqSource = { question: string; answer: McqAnswer; savedAt: number };
type OpenSource = { question: string; answer: string; savedAt: number };

/** Collects every answered question from recent flows, newest-first. */
function collectSources(
  now: number,
  excludeFlowId?: string
): { mcq: McqSource[]; open: OpenSource[] } {
  const active = loadFunnel();
  const flows: FunnelState[] = [
    ...(active?.profile ? [active] : []),
    ...loadHistory(),
  ].filter(
    (f) => f.flowId !== excludeFlowId && now - (f.savedAt || 0) <= CACHE_TTL_MS
  );

  const mcq: McqSource[] = [];
  const open: OpenSource[] = [];
  for (const f of flows) {
    for (const q of f.mcq?.questions ?? []) {
      const a = f.mcqAnswers[q.id];
      if (isMcqAnswered(a)) mcq.push({ question: q.question, answer: a, savedAt: f.savedAt || 0 });
    }
    for (const q of f.questionnaire?.questions ?? []) {
      const ans = (f.answers[q.id] ?? "").trim();
      if (ans) open.push({ question: q.question, answer: ans, savedAt: f.savedAt || 0 });
    }
  }
  // Newest first so the first similar match is also the most recent answer.
  mcq.sort((x, y) => y.savedAt - x.savedAt);
  open.sort((x, y) => y.savedAt - x.savedAt);
  return { mcq, open };
}

/**
 * Adapts a cached MCQ answer to a new question's option set. Returns null when
 * the options are incompatible (a documented edge case — no auto-fill then), so
 * we never inject an option the new question can't render.
 */
function adaptMcqAnswer(
  cached: McqAnswer,
  target: McqQuestionnaire["questions"][number]
): McqAnswer | null {
  const allowed = new Set(target.options);
  const selected = cached.selected.filter(
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
 * Finds cached answers for the questions of a new flow. Call at flow init,
 * before the first question is shown, then merge into the new FunnelState.
 */
export function findCachedAnswers(
  mcq: McqQuestionnaire | null,
  questionnaire: Questionnaire | null,
  now: number = Date.now(),
  excludeFlowId?: string
): CachedAnswers {
  const out: CachedAnswers = { mcqAnswers: {}, answers: {}, autoFilledIds: [] };
  const { mcq: mcqSrc, open: openSrc } = collectSources(now, excludeFlowId);

  for (const q of mcq?.questions ?? []) {
    const hit = mcqSrc.find((s) => isSimilarQuestion(q.question, s.question));
    if (!hit) continue;
    const adapted = adaptMcqAnswer(hit.answer, q);
    if (!adapted) continue;
    out.mcqAnswers[q.id] = adapted;
    out.autoFilledIds.push(q.id);
  }

  for (const q of questionnaire?.questions ?? []) {
    const hit = openSrc.find((s) => isSimilarQuestion(q.question, s.question));
    if (!hit) continue;
    out.answers[q.id] = hit.answer;
    out.autoFilledIds.push(q.id);
  }

  return out;
}

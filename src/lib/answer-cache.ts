/**
 * Cross-flow question caching (PRD Topic 1) — the LOCAL half.
 *
 * Users apply to many jobs and get asked semantically equivalent screening
 * questions each time. This mines the answers the user already gave in *recent*
 * flows (localStorage history + the active flow); signed-in users additionally
 * get their account-wide answers from /api/answers/match. Both halves run the
 * same matcher (answer-match.ts) so they can never disagree about what counts
 * as already answered.
 *
 * A 14-day TTL is a simple `savedAt` timestamp filter; nothing is deleted.
 */
import {
  FunnelState,
  formatMcqAnswer,
  isMcqAnswered,
  loadFunnel,
  loadHistory,
} from "./funnel";
import { McqQuestionnaire, Questionnaire } from "./types";
import {
  MatchedAnswers,
  StoredAnswer,
  matchAnswers,
} from "./answer-match";

/** Answers older than this are ignored (PRD 1.4 — "within the last 14 days"). */
export const CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Every answer this browser remembers, newest-first (the matcher's order). */
export function localAnswerSources(
  now: number = Date.now(),
  excludeFlowId?: string
): StoredAnswer[] {
  const active = loadFunnel();
  const flows: FunnelState[] = [
    ...(active?.profile ? [active] : []),
    ...loadHistory(),
  ].filter(
    (f) => f.flowId !== excludeFlowId && now - (f.savedAt || 0) <= CACHE_TTL_MS
  );

  const out: StoredAnswer[] = [];
  for (const f of flows) {
    for (const q of f.mcq?.questions ?? []) {
      const a = f.mcqAnswers[q.id];
      if (!isMcqAnswered(a)) continue;
      out.push({
        question: q.question,
        answer: formatMcqAnswer(a),
        kind: "mcq",
        selected: a.selected,
        other: a.other,
        updatedAt: f.savedAt || 0,
      });
    }
    for (const q of f.questionnaire?.questions ?? []) {
      const ans = (f.answers[q.id] ?? "").trim();
      if (!ans) continue;
      out.push({
        question: q.question,
        answer: ans,
        kind: "open",
        updatedAt: f.savedAt || 0,
      });
    }
  }
  // Newest first so the first similar match is also the most recent answer.
  return out.sort((x, y) => (y.updatedAt ?? 0) - (x.updatedAt ?? 0));
}

/**
 * Finds locally-cached answers for the questions of a new flow. Call at flow
 * init, before the first question is shown, then merge into the FunnelState.
 */
export function findCachedAnswers(
  mcq: McqQuestionnaire | null,
  questionnaire: Questionnaire | null,
  now: number = Date.now(),
  excludeFlowId?: string
): MatchedAnswers {
  return matchAnswers(localAnswerSources(now, excludeFlowId), mcq, questionnaire);
}

/**
 * Shared, pure helpers for the unified chat flow (PRD Topic 2 & 3). Turns a
 * FunnelState into an ordered question sequence across the three phases, and
 * derives each question's status flag. Kept React-free so both the chat surface
 * and the left navigation panel work off exactly one model.
 */
import { FunnelState, isMcqAnswered } from "./funnel";
import { McqQuestionnaire } from "./types";

export type McqQ = McqQuestionnaire["questions"][number];
export type OpenQ = { id: string; question: string; why: string };

/** phase 1 = mandatory MCQ · phase 2 = optional MCQ · phase 3 = open text. */
export type SeqItem =
  | { key: string; kind: "mcq"; phase: 1 | 2; q: McqQ }
  | { key: string; kind: "open"; phase: 3; q: OpenQ };

/** Ordered questions: required MCQ → optional MCQ → open. */
export function buildSequence(state: FunnelState): SeqItem[] {
  const mcq = state.mcq?.questions ?? [];
  const required = mcq.filter((q) => q.required);
  const optional = mcq.filter((q) => !q.required);
  const open = state.questionnaire?.questions ?? [];
  return [
    ...required.map(
      (q): SeqItem => ({ key: `mcq:${q.id}`, kind: "mcq", phase: 1, q })
    ),
    ...optional.map(
      (q): SeqItem => ({ key: `mcq:${q.id}`, kind: "mcq", phase: 2, q })
    ),
    ...open.map(
      (q): SeqItem => ({ key: `open:${q.id}`, kind: "open", phase: 3, q })
    ),
  ];
}

export type ItemStatus = "answered" | "auto" | "skipped" | "pending";

/** The status flag shown in the left panel and used to gate the cursor. */
export function itemStatus(
  item: SeqItem,
  state: FunnelState,
  extraSkipped?: Set<string>
): ItemStatus {
  const auto = state.autoFilledIds?.includes(item.q.id);
  if (item.kind === "mcq") {
    const a = state.mcqAnswers[item.q.id];
    if (isMcqAnswered(a)) return auto ? "auto" : "answered";
    if (a?.skipped || extraSkipped?.has(item.q.id)) return "skipped";
    return "pending";
  }
  const ans = (state.answers[item.q.id] ?? "").trim();
  if (ans) return auto ? "auto" : "answered";
  if (extraSkipped?.has(item.q.id)) return "skipped";
  return "pending";
}

/** True when the item needs no further prompting (answered/auto/skipped). */
export function isPassed(
  item: SeqItem,
  state: FunnelState,
  extraSkipped: Set<string>
): boolean {
  const st = itemStatus(item, state, extraSkipped);
  return st !== "pending";
}

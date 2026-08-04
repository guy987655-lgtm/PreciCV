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

/**
 * Ordered questions: required MCQ → open → optional MCQ.
 *
 * The core set the flow always asks (the capped MCQ budget plus the open
 * questions) comes first and contiguously; optional questions come last
 * because they only ever arrive from the opt-in role bank, appended after the
 * user has already answered everything else. Ordering them in the middle —
 * as this did while phase 2 was part of the default flow — would splice a
 * fresh batch of unanswered questions above open questions the user had
 * already answered.
 *
 * Questions already answered in an earlier application are dropped — a
 * returning user should only be asked what is genuinely new (they are
 * recapped in the chat instead). Pass `includeKnown` to get them back, which
 * is how the recap itself is built.
 *
 * The filter lives HERE and not on state.mcq/state.questionnaire on purpose:
 * profileWithAnswers() walks those pools to fold answers into the tailoring
 * payload, so removing a question there would silently drop its answer from
 * the generated CV.
 */
export function buildSequence(
  state: FunnelState,
  opts?: { includeKnown?: boolean }
): SeqItem[] {
  const known = new Set(opts?.includeKnown ? [] : (state.knownIds ?? []));
  const mcq = (state.mcq?.questions ?? []).filter((q) => !known.has(q.id));
  const required = mcq.filter((q) => q.required);
  const optional = mcq.filter((q) => !q.required);
  const open = (state.questionnaire?.questions ?? []).filter(
    (q) => !known.has(q.id)
  );
  return [
    ...required.map(
      (q): SeqItem => ({ key: `mcq:${q.id}`, kind: "mcq", phase: 1, q })
    ),
    ...open.map(
      (q): SeqItem => ({ key: `open:${q.id}`, kind: "open", phase: 3, q })
    ),
    ...optional.map(
      (q): SeqItem => ({ key: `mcq:${q.id}`, kind: "mcq", phase: 2, q })
    ),
  ];
}

/**
 * How one question should be DISPLAYED. Every surface (chat bubble, left
 * panel, edit modal) reads through here so they can never disagree about a
 * question's text or its example answer.
 */
export type QuestionView = {
  question: string;
  why: string;
  /** Example answer for open questions. */
  example: string;
};

export function questionView(state: FunnelState, item: SeqItem): QuestionView {
  return {
    question: item.q.question,
    why: item.kind === "open" ? item.q.why : "",
    example: state.sharpenSuggestions[item.q.id] ?? "",
  };
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

/**
 * How far the CORE set — everything the flow asks by default (the capped MCQ
 * budget plus the open questions) — has got. Optional role-bank questions are
 * excluded: they only exist after the user opts in, so they can never hold the
 * flow back.
 *
 * `coreDone` means nothing is still PENDING, which is deliberately not the same
 * as "everything was answered". Skipping is an offered, legitimate way to
 * resolve a question, and treating a skip as unresolved is what used to leave
 * the user with no way to finish: every exit from the questionnaire hung off
 * this flag, so one skipped open question hid the generate CTA for good.
 */
export type SeqProgress = {
  core: SeqItem[];
  /** Core items needing no further prompting (answered, auto-filled, skipped). */
  resolved: number;
  /** Core items genuinely answered — the honest number for user-facing copy. */
  answered: number;
  /** Core items still pending, in asking order. */
  pending: SeqItem[];
  coreDone: boolean;
};

export function sequenceProgress(
  seq: SeqItem[],
  state: FunnelState,
  extraSkipped: Set<string>
): SeqProgress {
  const core = seq.filter((it) => it.phase !== 2);
  const pending: SeqItem[] = [];
  let answered = 0;
  for (const item of core) {
    const st = itemStatus(item, state, extraSkipped);
    if (st === "pending") pending.push(item);
    else if (st !== "skipped") answered++;
  }
  return {
    core,
    resolved: core.length - pending.length,
    answered,
    pending,
    coreDone: pending.length === 0,
  };
}

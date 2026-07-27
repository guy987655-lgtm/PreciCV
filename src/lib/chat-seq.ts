/**
 * Shared, pure helpers for the unified chat flow (PRD Topic 2 & 3). Turns a
 * FunnelState into an ordered question sequence across the three phases, and
 * derives each question's status flag. Kept React-free so both the chat surface
 * and the left navigation panel work off exactly one model.
 */
import { FunnelState, OTHER_OPTION, isMcqAnswered } from "./funnel";
import { langDef } from "./i18n";
import { McqQuestionnaire } from "./types";

export type McqQ = McqQuestionnaire["questions"][number];
export type OpenQ = { id: string; question: string; why: string };

/** phase 1 = mandatory MCQ · phase 2 = optional MCQ · phase 3 = open text. */
export type SeqItem =
  | { key: string; kind: "mcq"; phase: 1 | 2; q: McqQ }
  | { key: string; kind: "open"; phase: 3; q: OpenQ };

/**
 * Ordered questions: required MCQ → optional MCQ → open.
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
    ...optional.map(
      (q): SeqItem => ({ key: `mcq:${q.id}`, kind: "mcq", phase: 2, q })
    ),
    ...open.map(
      (q): SeqItem => ({ key: `open:${q.id}`, kind: "open", phase: 3, q })
    ),
  ];
}

/**
 * How one question should be DISPLAYED — translated when the user flipped the
 * language, the English original otherwise. Every surface (chat bubble, left
 * panel, edit modal) reads through here so they can never disagree, and so
 * the stored answer keeps referring to the English text underneath.
 */
export type QuestionView = {
  question: string;
  why: string;
  /** English option → label to show. Empty when untranslated. */
  optionLabels: Record<string, string>;
  /** Example answer for open questions, translated when available. */
  example: string;
};

export function questionView(state: FunnelState, item: SeqItem): QuestionView {
  const original = {
    question: item.q.question,
    why: item.kind === "open" ? item.q.why : "",
    optionLabels: {} as Record<string, string>,
    example: state.sharpenSuggestions[item.q.id] ?? "",
  };
  const lang = state.uiLang;
  if (!lang) return original;
  const t = state.translations?.[lang]?.[item.q.id];
  if (!t) return original;

  const optionLabels: Record<string, string> = {};
  if (item.kind === "mcq") {
    // Position-matched (see translateQuestions). A model that returned the
    // wrong count would silently mislabel choices, so mismatches are ignored
    // and that question simply stays in English.
    if (t.options.length === item.q.options.length) {
      item.q.options.forEach((opt, i) => {
        if (t.options[i]?.trim()) optionLabels[opt] = t.options[i];
      });
    }
    const other = langDef(lang)?.otherLabel;
    if (other) optionLabels[OTHER_OPTION] = other;
  }
  return {
    question: t.question.trim() || original.question,
    why: t.why.trim() || original.why,
    optionLabels,
    example: t.example.trim() || original.example,
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

import { MasterProfile, McqQuestionnaire, Questionnaire } from "./types";

type McqQuestion = McqQuestionnaire["questions"][number];

/** Max segments in the questionnaire mini-navigation. */
export const MAX_MCQ_SEGMENTS = 6;

/**
 * Guards the segmented mini-navigation against over-fragmented topics
 * (e.g. an LLM giving every question its own topic): keeps the largest
 * topics as segments, folds the rest into "More", and reorders the pool
 * so each category is a contiguous run in the carousel.
 */
export function normalizeMcqPool(questions: McqQuestion[]): McqQuestion[] {
  if (questions.length === 0) return questions;
  const groups = new Map<string, McqQuestion[]>();
  for (const q of questions) {
    const t = q.topic?.trim() || "General";
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(q);
  }
  let entries = [...groups.entries()];
  if (entries.length <= MAX_MCQ_SEGMENTS) {
    return entries.flatMap(([, qs]) => qs);
  }

  const largest = Math.max(...entries.map(([, qs]) => qs.length));
  if (largest >= 3) {
    // Real categories exist — keep the largest, fold the rest into "More".
    const keep = new Set(
      [...entries]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, MAX_MCQ_SEGMENTS - 1)
        .map(([name]) => name)
    );
    const kept = entries.filter(([name]) => keep.has(name));
    const more: [string, McqQuestion[]] = [
      "More",
      entries
        .filter(([name]) => !keep.has(name))
        .flatMap(([, qs]) => qs)
        .map((q) => ({ ...q, topic: "More" })),
    ];
    entries = [...kept, more];
    return entries.flatMap(([, qs]) => qs);
  }

  // Degenerate case: (nearly) every question has its own topic — split the
  // pool into equal contiguous chunks, each labeled after its first topic.
  const chunkCount = Math.min(MAX_MCQ_SEGMENTS - 1, questions.length);
  const size = Math.ceil(questions.length / chunkCount);
  const out: McqQuestion[] = [];
  const usedLabels = new Set<string>();
  for (let i = 0; i < questions.length; i += size) {
    const chunk = questions.slice(i, i + size);
    let label = `${chunk[0].topic?.trim() || "General"} & more`;
    while (usedLabels.has(label)) label += " ";
    usedLabels.add(label);
    out.push(...chunk.map((q) => ({ ...q, topic: label })));
  }
  return out;
}

/**
 * Anonymous-funnel state, persisted to localStorage on every change so the
 * user can navigate away (logo click, refresh, accidental close) and come
 * back without losing the uploaded CV analysis or any answers.
 */

export const FUNNEL_KEY = "precicv_funnel_v1";
/** Signup stash consumed by /continue after OAuth (legacy import shape). */
export const PENDING_KEY = "precicv_pending";

/** Sentinel for the auto-appended free-text "Other…" choice. */
export const OTHER_OPTION = "__other__";

export type FunnelStep = "upload" | "mcq" | "open" | "job" | "gate";

export type McqAnswer = {
  /** Chosen options in click order — for ranked questions index = priority. */
  selected: string[];
  /** Free text entered when OTHER_OPTION is among the selected. */
  other?: string;
  /** The user explicitly skipped this question. */
  skipped?: boolean;
};

export type FunnelState = {
  step: FunnelStep;
  profile: MasterProfile | null;
  rawText: string;
  questionnaire: Questionnaire | null;
  mcq: McqQuestionnaire | null;
  /** quick-check answers, keyed by MCQ question id */
  mcqAnswers: Record<string, McqAnswer>;
  /** open-question answers, keyed by question id */
  answers: Record<string, string>;
  /** the role-standard question bank was already fetched */
  roleQuestionsLoaded: boolean;
  /** carousel position within the quick-check question pool */
  mcqIndex: number;
  jdText: string;
  savedAt: number;
};

export const EMPTY_FUNNEL: FunnelState = {
  step: "upload",
  profile: null,
  rawText: "",
  questionnaire: null,
  mcq: null,
  mcqAnswers: {},
  answers: {},
  roleQuestionsLoaded: false,
  mcqIndex: 0,
  jdText: "",
  savedAt: 0,
};

/** True when the question was genuinely answered (not skipped/empty). */
export function isMcqAnswered(a?: McqAnswer): boolean {
  if (!a || a.skipped || !a.selected?.length) return false;
  if (a.selected.length === 1 && a.selected[0] === OTHER_OPTION) {
    return (a.other ?? "").trim().length > 0;
  }
  return true;
}

/** Human-readable answer: ranked picks become "1) A  2) B". */
export function formatMcqAnswer(a: McqAnswer): string {
  const parts = (a.selected ?? [])
    .map((o) =>
      o === OTHER_OPTION
        ? (a.other ?? "").trim()
          ? `Other: ${(a.other ?? "").trim()}`
          : ""
        : o
    )
    .filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  return parts.map((p, i) => `${i + 1}) ${p}`).join("  ");
}

export function loadFunnel(): FunnelState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FUNNEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    // Migrate the pre-ranking answer shape (plain option strings).
    const mcqAnswers: Record<string, McqAnswer> = {};
    for (const [k, v] of Object.entries(parsed.mcqAnswers ?? {})) {
      if (typeof v === "string") {
        if (v) mcqAnswers[k] = { selected: [v] };
      } else if (v && typeof v === "object") {
        const a = v as McqAnswer;
        mcqAnswers[k] = { ...a, selected: a.selected ?? [] };
      }
    }
    const state = { ...EMPTY_FUNNEL, ...(parsed as FunnelState), mcqAnswers };
    // The "card" step was removed from the flow — the dossier lives on /card.
    if ((state.step as string) === "card") state.step = "job";
    // Repair over-fragmented topic segmentation in already-saved pools.
    if (state.mcq?.questions?.length) {
      state.mcq = { questions: normalizeMcqPool(state.mcq.questions) };
    }
    return state;
  } catch {
    return null;
  }
}

export function saveFunnel(state: FunnelState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      FUNNEL_KEY,
      JSON.stringify({ ...state, savedAt: Date.now() })
    );
  } catch {
    // Storage full / private mode — the funnel still works in-memory.
  }
}

export function clearFunnel() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(FUNNEL_KEY);
}

/**
 * Writes the stash /continue imports right after OAuth. Quick-check answers
 * are folded into the same Q&A list as the open answers so the existing
 * /api/try/import endpoint turns them all into additionalFacts.
 */
export function stashForSignup(state: FunnelState) {
  if (!state.profile) return;
  const mcqAnswered = (state.mcq?.questions ?? []).filter((q) =>
    isMcqAnswered(state.mcqAnswers[q.id])
  );
  const questions = [
    ...mcqAnswered.map((q) => ({
      id: `mcq_${q.id}`,
      question: q.question,
      why: "",
    })),
    ...(state.questionnaire?.questions ?? []),
  ];
  const answers: Record<string, string> = {};
  for (const q of mcqAnswered) {
    answers[`mcq_${q.id}`] = formatMcqAnswer(state.mcqAnswers[q.id]);
  }
  for (const [k, v] of Object.entries(state.answers)) answers[k] = v;

  localStorage.setItem(
    PENDING_KEY,
    JSON.stringify({
      profile: state.profile,
      rawText: state.rawText,
      questionnaire: { questions },
      answers,
      jdText: state.jdText,
      savedAt: Date.now(),
    })
  );
}

import { MasterProfile, McqQuestionnaire, Questionnaire } from "./types";

/**
 * Anonymous-funnel state, persisted to localStorage on every change so the
 * user can navigate away (logo click, refresh, accidental close) and come
 * back without losing the uploaded CV analysis or any answers.
 */

export const FUNNEL_KEY = "precicv_funnel_v1";
/** Signup stash consumed by /continue after OAuth (legacy import shape). */
export const PENDING_KEY = "precicv_pending";

export type FunnelStep = "upload" | "mcq" | "open" | "card" | "job" | "gate";

export type FunnelState = {
  step: FunnelStep;
  profile: MasterProfile | null;
  rawText: string;
  questionnaire: Questionnaire | null;
  mcq: McqQuestionnaire | null;
  /** quick-check answers, keyed by MCQ question id */
  mcqAnswers: Record<string, string>;
  /** open-question answers, keyed by question id */
  answers: Record<string, string>;
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
  jdText: "",
  savedAt: 0,
};

export function loadFunnel(): FunnelState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(FUNNEL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { ...EMPTY_FUNNEL, ...(parsed as FunnelState) };
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
  const mcqAnswered = (state.mcq?.questions ?? []).filter(
    (q) => state.mcqAnswers[q.id]
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
  for (const q of mcqAnswered) answers[`mcq_${q.id}`] = state.mcqAnswers[q.id];
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

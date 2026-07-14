import {
  CvTemplate,
  GenerationResult,
  GreetingInfo,
  MasterProfile,
  MAX_REQUIRED_QUESTIONS,
  McqQuestionnaire,
  Questionnaire,
} from "./types";
import type { CvVersion } from "./cv-session";

type McqQuestion = McqQuestionnaire["questions"][number];

/** Max segments in the questionnaire mini-navigation. */
export const MAX_MCQ_SEGMENTS = 6;

/**
 * Guards the segmented mini-navigation against over-fragmented topics
 * (e.g. an LLM giving every question its own topic): required questions
 * come first (capped at MAX_REQUIRED_QUESTIONS — extras demote to
 * optional), then the optional pool grouped by topic so each category is
 * a contiguous run in the carousel.
 */
export function normalizeMcqPool(input: McqQuestion[]): McqQuestion[] {
  if (input.length === 0) return input;

  // Required first, hard-capped; everything past the cap becomes optional.
  let requiredSeen = 0;
  const normalized = input.map((q) => {
    if (!q.required) return q;
    requiredSeen++;
    return requiredSeen <= MAX_REQUIRED_QUESTIONS
      ? q
      : { ...q, required: false };
  });
  const required = normalized.filter((q) => q.required);
  const questions = normalized.filter((q) => !q.required);
  if (questions.length === 0) return required;
  const groups = new Map<string, McqQuestion[]>();
  for (const q of questions) {
    const t = q.topic?.trim() || "General";
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t)!.push(q);
  }
  let entries = [...groups.entries()];
  if (entries.length <= MAX_MCQ_SEGMENTS) {
    return [...required, ...entries.flatMap(([, qs]) => qs)];
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
    return [...required, ...entries.flatMap(([, qs]) => qs)];
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
  return [...required, ...out];
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

// The old "mcq" (Quick check) and "open" (Sharpen) steps were merged into one
// conversational "chat" step (PRD Topic 2). Saved states are migrated on load.
export type FunnelStep = "upload" | "chat" | "gate";

/** Funnel step sequence — shared by the stepper, resume and History. */
export const STEP_ORDER: FunnelStep[] = ["upload", "chat", "gate"];

/** Fired by the Home nav button so a mounted funnel swaps to the hero. */
export const HOME_EVENT = "specv:home";

/**
 * Home always lands on the homepage hero: the active flow is kept — only
 * its visible step returns to "upload" (furthestStep survives, so the
 * hero's "Continue progress" button can jump straight back).
 */
export function goHome() {
  if (typeof window === "undefined") return;
  const s = loadFunnel();
  if (s?.profile && s.step !== "upload") saveFunnel({ ...s, step: "upload" });
  window.dispatchEvent(new Event(HOME_EVENT));
}

export type McqAnswer = {
  /** Chosen options in click order — for ranked questions index = priority. */
  selected: string[];
  /** Free text entered when OTHER_OPTION is among the selected. */
  other?: string;
  /** The user explicitly skipped this question. */
  skipped?: boolean;
};

export type FunnelState = {
  /** unique per flow — a new flow starts on every CV upload */
  flowId: string;
  step: FunnelStep;
  /** the furthest step index the user reached (for stepper + resume) */
  furthestStep: number;
  profile: MasterProfile | null;
  rawText: string;
  questionnaire: Questionnaire | null;
  mcq: McqQuestionnaire | null;
  /** quick-check answers, keyed by MCQ question id */
  mcqAnswers: Record<string, McqAnswer>;
  /** open-question answers, keyed by question id */
  answers: Record<string, string>;
  /** when each question was FIRST answered (ms), keyed by question id —
   *  powers the My Card progress chart (PRD v2 Topic 10) */
  answerTimes: Record<string, number>;
  /** the role-standard question bank was already fetched */
  roleQuestionsLoaded: boolean;
  /** carousel position within the quick-check question pool */
  mcqIndex: number;
  jdText: string;
  /** the generated deliverables — persisted so History can re-download */
  results: GenerationResult | null;
  template: CvTemplate;
  /** CV preview background theme — persists with the rest of the view state. */
  cvTheme: "light" | "dark";
  /** Split-view layout preference (per-template splitMode still overrides). */
  splitView: boolean;
  downloadedCv: boolean;
  downloadedReport: boolean;
  savedAt: number;
  /** milestone snapshots (initial gen / regenerate / download); max 11 */
  versions: CvVersion[];
  /** AI snippet rewrites used this flow (cap MAX_REWRITES) */
  rewritesUsed: number;
  /** report regenerations used this flow (cap MAX_REPORT_REGENS) */
  regensUsed: number;
  /** the persisted report is out of sync with the CV after inline edits */
  reportStale: boolean;
  /** AI-suggested example answers for the Sharpen step, keyed by question id */
  sharpenSuggestions: Record<string, string>;
  /** Question ids whose answer was auto-filled from a recent flow (Topic 1). */
  autoFilledIds: string[];
  /** User-chosen display name for this flow/process (Topic 4). Empty = derive. */
  processName: string;
  /** JD-derived greeting data — null when the LLM call failed/skipped. */
  greetingInfo: GreetingInfo | null;
  /** The user's one-time free-text reply to the greeting ("" = skipped). */
  greetingReply: string;
  /** The greeting exchange finished (reply sent or skipped). */
  greetingDone: boolean;
  /** Post-mandatory branch choice. "" = not yet chosen. */
  branchChoice: "" | "continue" | "generate";
  /** In the continue branch, the user clicked [Let's Start]. */
  branchStarted: boolean;
};

export const EMPTY_FUNNEL: FunnelState = {
  flowId: "",
  step: "upload",
  furthestStep: 0,
  profile: null,
  rawText: "",
  questionnaire: null,
  mcq: null,
  mcqAnswers: {},
  answers: {},
  answerTimes: {},
  roleQuestionsLoaded: false,
  mcqIndex: 0,
  jdText: "",
  results: null,
  template: "classic",
  cvTheme: "light",
  splitView: false,
  downloadedCv: false,
  downloadedReport: false,
  savedAt: 0,
  versions: [],
  rewritesUsed: 0,
  regensUsed: 0,
  reportStale: false,
  sharpenSuggestions: {},
  autoFilledIds: [],
  processName: "",
  greetingInfo: null,
  greetingReply: "",
  greetingDone: false,
  branchChoice: "",
  branchStarted: false,
};

/** Topic 10 — records when a question was FIRST genuinely answered. */
export function stampAnswerTime(
  s: FunnelState,
  qId: string,
  answered: boolean
): Record<string, number> {
  return answered && !s.answerTimes[qId]
    ? { ...s.answerTimes, [qId]: Date.now() }
    : s.answerTimes;
}

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
    // Saved before the conversational-script release → skip greeting/transition
    // retroactively and restore the old always-visible-Generate behavior.
    if (!("branchChoice" in parsed) && state.profile) {
      state.greetingDone = true;
      state.branchChoice = "continue";
      state.branchStarted = true;
    }
    // Merged steps: "mcq"+"open" → the unified "chat" step (PRD Topic 2).
    if (["mcq", "open"].includes(state.step as string)) {
      state.step = "chat";
    }
    // Removed steps: "card" (dossier lives on /card) and "job" (the JD is
    // now required upfront) — route saved states somewhere sensible.
    if (["card", "job"].includes(state.step as string)) {
      state.step = (state.jdText?.trim().length ?? 0) >= 100 ? "gate" : "upload";
    }
    // furthestStep is an index into STEP_ORDER, which shrank — clamp it and
    // make sure it at least covers the (possibly migrated) current step.
    state.furthestStep = Math.min(
      Math.max(state.furthestStep ?? 0, STEP_ORDER.indexOf(state.step)),
      STEP_ORDER.length - 1
    );
    // Repair over-fragmented topic segmentation in already-saved pools.
    if (state.mcq?.questions?.length) {
      state.mcq = { questions: normalizeMcqPool(state.mcq.questions) };
    }
    // Topic 10 backfill: answers saved before per-answer timestamps existed
    // get the flow's last-saved time as their (best-known) answer time.
    const times = { ...state.answerTimes };
    const backfill = state.savedAt || Date.now();
    for (const [qid, a] of Object.entries(state.mcqAnswers)) {
      if (isMcqAnswered(a) && !times[qid]) times[qid] = backfill;
    }
    for (const [qid, v] of Object.entries(state.answers ?? {})) {
      if ((v ?? "").trim() && !times[qid]) times[qid] = backfill;
    }
    state.answerTimes = times;
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

/* ------------------------------------------------------------------ */
/* History — every CV upload starts a flow; old flows are never lost   */
/* ------------------------------------------------------------------ */

export const HISTORY_KEY = "specv_history_v1";
const HISTORY_MAX = 20;

export function loadHistory(): FunnelState[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.map((f) => ({ ...EMPTY_FUNNEL, ...f })) as FunnelState[];
  } catch {
    return [];
  }
}

function persistHistory(flows: FunnelState[]) {
  try {
    localStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(flows.slice(0, HISTORY_MAX))
    );
  } catch {
    // Storage full — drop the oldest half and retry once.
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(flows.slice(0, Math.ceil(HISTORY_MAX / 2)))
      );
    } catch {
      /* give up quietly */
    }
  }
}

/** Archives a flow (deduped by flowId, newest first). */
export function pushToHistory(state: FunnelState) {
  if (typeof window === "undefined" || !state.profile) return;
  const id = state.flowId || crypto.randomUUID();
  const rest = loadHistory().filter((f) => f.flowId !== id);
  persistHistory([{ ...state, flowId: id }, ...rest]);
}

export function removeFromHistory(flowId: string) {
  if (typeof window === "undefined") return;
  persistHistory(loadHistory().filter((f) => f.flowId !== flowId));
}

/** Updates an archived flow in place (e.g. download flags). */
export function updateHistoryEntry(flowId: string, patch: Partial<FunnelState>) {
  if (typeof window === "undefined") return;
  persistHistory(
    loadHistory().map((f) => (f.flowId === flowId ? { ...f, ...patch } : f))
  );
}

/**
 * Makes an archived flow the active one; the current active flow (if any,
 * and different) is archived first so nothing is ever overwritten.
 */
export function activateFlow(flow: FunnelState) {
  const active = loadFunnel();
  if (active?.profile && active.flowId !== flow.flowId) pushToHistory(active);
  removeFromHistory(flow.flowId);
  saveFunnel(flow);
}

/**
 * Default display name for a flow: "[Company] - [Job Title]", with "General"
 * standing in when the JD named no company, falling back to
 * "New Application - [date]" for flows that haven't generated yet. Used until
 * the user renames the flow on the History dashboard.
 */
export function defaultProcessName(state: FunnelState): string {
  const job = state.results?.jobTitle?.trim();
  const company = state.results?.company?.trim();
  if (job) return `${company || "General"} - ${job}`;
  const date = new Date(state.savedAt || Date.now()).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `New Application - ${date}`;
}

/** The flow's shown name: an explicit rename wins, else the derived default. */
export function flowDisplayName(state: FunnelState): string {
  return state.processName?.trim() || defaultProcessName(state);
}

/**
 * The profile with every questionnaire answer folded into additionalFacts —
 * this is what generation must receive, otherwise the quick check and the
 * open questions have zero effect on the tailored CV.
 */
export function profileWithAnswers(state: FunnelState): MasterProfile | null {
  if (!state.profile) return null;
  const facts: string[] = [];
  for (const q of state.mcq?.questions ?? []) {
    const a = state.mcqAnswers[q.id];
    if (isMcqAnswered(a)) facts.push(`${q.question} — ${formatMcqAnswer(a)}`);
  }
  for (const q of state.questionnaire?.questions ?? []) {
    const ans = (state.answers[q.id] ?? "").trim();
    if (ans) facts.push(`${q.question} — ${ans}`);
  }
  return {
    ...state.profile,
    additionalFacts: [...state.profile.additionalFacts, ...facts],
  };
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

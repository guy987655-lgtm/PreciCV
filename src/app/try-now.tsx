"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import {
  MAX_REPORT_REGENS,
  MAX_REWRITES,
  McqQuestionnaire,
  Questionnaire,
  RewriteLength,
  TailoredCv,
} from "@/lib/types";
import {
  CvVersion,
  VersionKind,
  appendVersion,
  makeVersion,
} from "@/lib/cv-session";
import { effectiveSplit } from "@/lib/templates";
import { isSimilarQuestion } from "@/lib/text";
import {
  EMPTY_FUNNEL,
  FunnelState,
  FunnelStep,
  HOME_EVENT,
  McqAnswer,
  STEP_ORDER,
  TranslatedQuestion,
  clearFunnel,
  isMcqAnswered,
  loadFunnel,
  normalizeMcqPool,
  profileWithAnswers,
  pushToHistory,
  saveFunnel,
  stampAnswerTime,
  stashForSignup,
} from "@/lib/funnel";
import { findCachedAnswers } from "@/lib/answer-cache";
import { EMPTY_MATCH, MatchedAnswers, mergeMatches } from "@/lib/answer-match";
import { generateWithRetry } from "@/lib/generate-client";
import { printBoth, printFile } from "@/lib/download";
import { simMeta, useSimUser } from "@/lib/sim-user";
import { useSession } from "@/lib/use-session";
import { Badge, Button, Card, Modal, Spinner, Textarea, Toast } from "@/components/ui";
import { Paywall } from "@/components/paywall";
import { ChatFlow } from "@/components/chat-flow";
import { CvRenderer } from "@/components/cv-renderer";
import { DiffChangeLines } from "@/components/diff-change";
import { ReportPage } from "@/components/report-page";
import { TONE_META } from "@/components/interview-faces";
import { TemplateCatalog } from "@/components/template-catalog";
import {
  AiSectionToggle,
  CvToolbar,
  DisplayReviewButton,
  RefreshReportButton,
  SplitToggle,
  ThemeToggle,
  ToolbarDivider,
  EditToolbar,
} from "@/components/cv-controls";
import { RewriteTooltip } from "@/components/rewrite-tooltip";
import {
  RESULTS_TOUR_KEY,
  RESULTS_TOUR_STEPS,
  ResultsTour,
} from "@/components/results-tour";
import { VersionStrip } from "@/components/version-strip";
import { FullScreenCv } from "@/components/full-screen-cv";

const STEP_LABELS: Record<FunnelStep, string> = {
  upload: "CV + Job",
  chat: "Questions",
  gate: "Results",
};

/** Numbered step marker (1 → 2 → 3) that guides the upload funnel. */
function StepNum({ n }: { n: number }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-[15px] font-extrabold text-white shadow-[0_2px_0_#1F4A36]">
      {n}
    </span>
  );
}

/** Small accent circle with a white ✓ — the recurring success motif. */
function CheckCircle({ size = 26 }: { size?: number }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-accent font-extrabold text-white"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      ✓
    </span>
  );
}

/**
 * The homepage funnel: upload a CV + (optionally) paste a target job →
 * quick multiple-choice check → open questions → the job → gate. The gate
 * depends on the user state: unregistered users hit the Registration Wall;
 * registered users with a profile hit the Paywall. Every change persists
 * to localStorage; /continue imports the stash right after OAuth.
 */
export function TryNow() {
  const router = useRouter();
  const sim = useSimUser();
  const simUserMeta = simMeta(sim);
  const { signedIn } = useSession();
  /**
   * A REAL Supabase session always counts as registered. `simMeta` is the
   * dev-only simulator and reports "guest" in production, which is why a
   * signed-in user used to be sent back through the register wall — and why
   * their flow stayed in localStorage instead of landing in Supabase (and so
   * never showed up in History).
   */
  const meta = signedIn ? { ...simUserMeta, registered: true } : simUserMeta;
  const [state, setState] = useState<FunnelState>(EMPTY_FUNNEL);
  const [hydrated, setHydrated] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const uploadCardRef = useRef<HTMLDivElement>(null);

  // V1 public launch: no accounts/payment yet — guests generate directly,
  // rate-limited server-side (src/lib/rate-limit.ts). Results live in the
  // persisted funnel state so History can resume and re-download them.
  const [generateBusy, setGenerateBusy] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  // Split view + CV background theme live in the persisted funnel state so
  // the whole Results view restores exactly across refreshes (PRD v2 Topic 3).
  const splitView = state.splitView;
  const cvTheme = state.cvTheme;
  const setSplitView = (next: boolean) => patch({ splitView: next });
  const setCvTheme = (t: "light" | "dark") => patch({ cvTheme: t });
  // Full-screen preview: the whole CV shown at once, scaled to fit.
  const [fullScreen, setFullScreen] = useState(false);
  // Re-editing a finished flow → confirm before generating a fresh report.
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);
  // Inline-editing the tailored CV directly on the Results page.
  const [editing, setEditing] = useState(false);
  // §2.2 — lastSavedState: the CV exactly as it was when Edit Mode was
  // entered. isDirty compares the live CV against it; Reset restores it.
  const [editSnapshot, setEditSnapshot] = useState<{
    json: string;
    cv: TailoredCv;
    reportStale: boolean;
  } | null>(null);
  // Fetching AI example answers for the Sharpen-step placeholders.
  const [sharpenBusy, setSharpenBusy] = useState(false);
  // Translating the questionnaire into the user's language (Topic 1).
  const [translating, setTranslating] = useState(false);
  // Rebuilding the interview report around the edited CV.
  const [reportBusy, setReportBusy] = useState(false);
  // Deferred print request — fired after a smart-download report refresh so the
  // printed DOM reflects the freshly regenerated report (see effect below).
  const [printRequest, setPrintRequest] = useState(false);
  // Undo window for the (now instant) Reset — holds the discarded edits for
  // a few seconds so a misclick is recoverable (PRD v2 Topic 6).
  const [resetUndo, setResetUndo] = useState<{
    cv: TailoredCv;
    reportStale: boolean;
  } | null>(null);
  const resetToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The report sections wrapper — "Refresh report" scrolls here and fades it
  // while the new report builds (PRD v2 Topic 8).
  const reportSectionsRef = useRef<HTMLDivElement>(null);
  // Original Download button anchor — when it scrolls out of view a floating
  // copy appears fixed top-right (PRD v2 Topic 9).
  const downloadAnchorRef = useRef<HTMLDivElement>(null);
  const [downloadFloating, setDownloadFloating] = useState(false);
  // The CV preview wrapper — the RewriteTooltip watches selections inside it.
  const cvPreviewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const results = state.results;
  const template = state.template;
  // Split view honoring per-template constraints (mono/timeline/grid = never;
  // columnrule = always) regardless of the user's toggle.
  const shownSplit = effectiveSplit(template, splitView);
  /**
   * The download bundle is two files: the CV and the interview report. The
   * report's centerpiece is the simulation, which the model occasionally
   * omits (a truncated response still parses — see generateTailoredCv), so
   * the button must not promise a second file that would come out hollow.
   */
  const simulationMissing =
    results !== null && results.simulation.questions.length === 0;
  const downloadLabel = simulationMissing
    ? "Download my CV (PDF)"
    : "Download my files (2 PDFs)";
  // §2.2 isDirty — true from the first change relative to lastSavedState.
  const isDirty =
    editing &&
    editSnapshot !== null &&
    results !== null &&
    JSON.stringify(results.cv) !== editSnapshot.json;

  // Restore any in-progress funnel (logo click / refresh must not lose data).
  useEffect(() => {
    const saved = loadFunnel();
    if (saved?.profile) setState(saved);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveFunnel(state);
  }, [state, hydrated]);

  // Every step transition starts at the top of the page — otherwise a long
  // step (e.g. the quick check) leaves the next step scrolled halfway down.
  useEffect(() => {
    if (hydrated) window.scrollTo({ top: 0 });
  }, [state.step, hydrated]);

  // Deferred print: only once any smart-download report refresh has finished
  // AND its result has rendered do we print, so the printed report file always
  // reflects the latest CV. Records the "download" milestone version.
  useEffect(() => {
    if (!printRequest || reportBusy) return;
    setState((s) => {
      const flags = { downloadedCv: true, downloadedReport: true };
      if (!s.results) return { ...s, ...flags };
      const version = makeVersion("download", {
        cv: s.results.cv,
        diff: s.results.diff,
        simulation: s.results.simulation,
        template: s.template,
      });
      return { ...s, ...flags, versions: appendVersion(s.versions, version) };
    });
    const meta = {
      name: state.profile?.contact.fullName,
      company: state.results?.company,
    };
    // No simulation → no second file worth handing over (its questions are
    // the entire point of the report), so print the CV alone.
    if (state.results && state.results.simulation.questions.length === 0) {
      printFile("cv", meta);
    } else {
      printBoth(meta);
    }
    setPrintRequest(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printRequest, reportBusy]);

  // Topic 9 — watch the in-flow Download button; the floating copy shows only
  // while the original is scrolled out of the viewport.
  const resultsShown = state.step === "gate" && !meta.registered && results !== null;

  // Topic 4 — first-ever arrival at the Results view auto-starts the guided
  // tour; completing or dismissing it sets the flag so it never re-runs.
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    if (!resultsShown || !hydrated) return;
    // Small delay so the freshly-rendered Results view settles (layout,
    // catalog images) before the spotlight measures its targets.
    const t = setTimeout(() => {
      try {
        if (!localStorage.getItem(RESULTS_TOUR_KEY)) setShowTour(true);
      } catch {
        // Private mode — no tour flag, no tour.
      }
    }, 400);
    return () => clearTimeout(t);
  }, [resultsShown, hydrated]);
  const endTour = useCallback(() => {
    setShowTour(false);
    try {
      localStorage.setItem(RESULTS_TOUR_KEY, "1");
    } catch {
      /* private mode */
    }
  }, []);
  useEffect(() => {
    const el = downloadAnchorRef.current;
    if (!resultsShown || !el) {
      setDownloadFloating(false);
      return;
    }
    const obs = new IntersectionObserver(([entry]) =>
      setDownloadFloating(!entry.isIntersecting)
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [resultsShown]);

  // Home button while the funnel is mounted → swap back to the hero
  // (the flow itself is untouched; "Continue progress" resumes it).
  useEffect(() => {
    const onHome = () => setState((s) => ({ ...s, step: "upload" }));
    window.addEventListener(HOME_EVENT, onHome);
    return () => window.removeEventListener(HOME_EVENT, onHome);
  }, []);

  // Reaching the chat step lazily fetches AI example-answer placeholders for
  // the open questions (used as inspiration in the chat text inputs).
  useEffect(() => {
    if (hydrated && state.step === "chat") loadSharpenSuggestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, state.step]);

  function patch(p: Partial<FunnelState>) {
    setState((s) => ({ ...s, ...p }));
  }
  function goTo(step: FunnelStep) {
    setError("");
    setState((s) => ({
      ...s,
      step,
      furthestStep: Math.max(s.furthestStep ?? 0, STEP_ORDER.indexOf(step)),
    }));
  }

  /* ------------- quick-check answer handling (functional updates) ---- */
  function updateMcqAnswer(qId: string, next: McqAnswer) {
    setState((s) => ({
      ...s,
      mcqAnswers: { ...s.mcqAnswers, [qId]: next },
      answerTimes: stampAnswerTime(s, qId, isMcqAnswered(next)),
    }));
  }
  function setMcqSkipped(qId: string, skipped: boolean) {
    setState((s) => {
      const prev = s.mcqAnswers[qId] ?? { selected: [] };
      return {
        ...s,
        mcqAnswers: { ...s.mcqAnswers, [qId]: { ...prev, skipped } },
      };
    });
  }
  function answerOpen(qId: string, text: string) {
    setState((s) => ({
      ...s,
      answers: { ...s.answers, [qId]: text },
      answerTimes: stampAnswerTime(s, qId, text.trim().length > 0),
    }));
  }
  /** Topic 1: an auto-filled answer the user edited is no longer "auto". */
  function clearAutoFilled(qId: string) {
    setState((s) => ({
      ...s,
      autoFilledIds: s.autoFilledIds.filter((id) => id !== qId),
    }));
  }

  /** Accept a file from the OS picker or a drag-and-drop, guarding the type. */
  function acceptFile(f: File | null | undefined) {
    if (!f) return;
    if (!/\.(pdf|docx)$/i.test(f.name)) {
      setError("Please upload a PDF or DOCX file.");
      return;
    }
    setError("");
    setFile(f);
  }

  async function analyze() {
    if (!file) return;
    setBusy(true);
    setError("");
    trackButtonClick({
      button_name: "try_now_analyze",
      action: "upload",
      button_text: "Analyze my CV — free",
      click_source: "landing_try_now",
    });
    try {
      const form = new FormData();
      form.append("file", file);
      // The target job makes the questionnaire gap-bridging specific (§4.2).
      if (state.jdText.trim()) form.append("jd", state.jdText);
      const res = await fetch("/api/try/parse-cv", { method: "POST", body: form });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      // A new CV upload starts a NEW flow — the previous one is archived
      // to History, never overwritten.
      if (state.profile) pushToHistory(state);
      const mcqPool = { questions: normalizeMcqPool(data.mcq?.questions ?? []) };
      const questionnaire = data.questionnaire ?? null;
      /**
       * Progressive profiling: cross-reference this job's questions against
       * everything the user has already answered — on this device (the
       * localStorage cache) and, when signed in, on their account. Matches
       * are answered up front and never asked again, so an active user gets
       * a short questionnaire instead of the same one every time.
       */
      const cached = findCachedAnswers(mcqPool, questionnaire, Date.now());
      const remembered = signedIn
        ? await matchServerAnswers(mcqPool, questionnaire)
        : EMPTY_MATCH;
      // The account is the stronger source: it survives devices and cleared
      // storage, and holds the answers the user curated in My Card.
      const known = mergeMatches(remembered, cached);
      const hasQuestions =
        mcqPool.questions.length > 0 ||
        (questionnaire?.questions?.length ?? 0) > 0;
      // Still the chat step even when everything is already known: the chat
      // is where the recap and the generate CTA live, and the gate branches
      // below only render for specific user states. The user simply has
      // nothing left to answer there.
      const nextStep: FunnelStep = hasQuestions ? "chat" : "gate";
      setState((s) => ({
        ...s,
        flowId: crypto.randomUUID(),
        profile: data.profile,
        rawText: data.rawText ?? "",
        questionnaire,
        mcq: mcqPool,
        mcqAnswers: known.mcqAnswers,
        answers: known.answers,
        // Fresh flow — timestamps start over; auto-filled answers count from
        // now (their earlier originals live on in the archived flow).
        answerTimes: Object.fromEntries(
          [
            ...Object.keys(known.mcqAnswers),
            ...Object.keys(known.answers),
          ].map((id) => [id, Date.now()])
        ),
        autoFilledIds: known.knownIds,
        knownIds: known.knownIds,
        processName: "",
        roleQuestionsLoaded: false,
        mcqIndex: 0,
        results: null,
        downloadedCv: false,
        downloadedReport: false,
        versions: [],
        rewritesUsed: 0,
        regensUsed: 0,
        reportStale: false,
        sharpenSuggestions: {},
        greetingInfo: data.greeting ?? null,
        greetingReply: "",
        greetingDone: false,
        branchChoice: "",
        branchStarted: false,
        step: nextStep,
        furthestStep: STEP_ORDER.indexOf(nextStep),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The account-wide half of progressive profiling. Non-fatal by design: if
   * it fails the user simply answers a question they had answered before,
   * which is far better than blocking the upload.
   */
  async function matchServerAnswers(
    mcqPool: McqQuestionnaire,
    questionnaire: Questionnaire | null
  ): Promise<MatchedAnswers> {
    try {
      const res = await fetch("/api/answers/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcq: mcqPool, questionnaire }),
      });
      if (!res.ok) return EMPTY_MATCH;
      const data = await readJson(res);
      return {
        mcqAnswers: data.mcqAnswers ?? {},
        answers: data.answers ?? {},
        knownIds: data.knownIds ?? [],
      };
    } catch {
      return EMPTY_MATCH;
    }
  }

  /** Fetches the role-standard question bank (what the market expects). */
  async function loadRoleQuestions() {
    if (!state.profile || loadingMore) return;
    setLoadingMore(true);
    setError("");
    trackButtonClick({
      button_name: "load_role_questions",
      action: "generate",
      button_text: "Generate more role questions",
      click_source: "landing_try_now",
    });
    try {
      const existingQuestions = (state.mcq?.questions ?? []);
      const res = await fetch("/api/try/role-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: state.profile,
          existingTopics: existingQuestions.map((q) => q.topic || q.question),
          // Send the full question texts so the model avoids repeating them.
          existingQuestions: existingQuestions.map((q) => q.question),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to load questions");
      const incoming: McqQuestionnaire = data.mcq ?? { questions: [] };
      setState((s) => {
        const existing = s.mcq?.questions ?? [];
        // Strict de-dup: drop any incoming question that is similar to one the
        // user already has — and especially one they already ANSWERED — using
        // fuzzy matching (not exact text) so reworded near-duplicates are
        // caught and never re-render as fresh unanswered questions.
        const answeredTexts = existing
          .filter((q) => isMcqAnswered(s.mcqAnswers[q.id]))
          .map((q) => q.question);
        const existingTexts = existing.map((q) => q.question);
        const kept: typeof incoming.questions = [];
        for (const q of incoming.questions) {
          const dupExisting = existingTexts.some((t) =>
            isSimilarQuestion(t, q.question)
          );
          const dupAnswered = answeredTexts.some((t) =>
            isSimilarQuestion(t, q.question)
          );
          const dupWithinBatch = kept.some((k) =>
            isSimilarQuestion(k.question, q.question)
          );
          if (dupExisting || dupAnswered || dupWithinBatch) continue;
          kept.push(q);
        }
        const fresh = kept.map((q, i) => ({ ...q, id: `role_${i}_${q.id || i}` }));
        // Re-group so every category stays a contiguous carousel run.
        const merged = normalizeMcqPool([...existing, ...fresh]);
        // Auto-advance straight to the first newly generated question so the
        // user immediately sees the fresh questions are ready (no manual Next).
        const freshIds = new Set(fresh.map((q) => q.id));
        const firstFresh = merged.findIndex((q) => freshIds.has(q.id));
        const currentId = existing[s.mcqIndex]?.id;
        const keptIndex = merged.findIndex((q) => q.id === currentId);
        return {
          ...s,
          roleQuestionsLoaded: true,
          mcq: { questions: merged },
          mcqIndex: firstFresh >= 0 ? firstFresh : keptIndex >= 0 ? keptIndex : 0,
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoadingMore(false);
    }
  }

  /**
   * Lazily fetches an AI example answer per open question (grounded in the CV)
   * to seed the Sharpen inputs as inspiration placeholders. Runs once per flow;
   * failures are non-fatal (the inputs fall back to a generic placeholder).
   */
  async function loadSharpenSuggestions() {
    const qs = state.questionnaire?.questions ?? [];
    if (
      !state.profile ||
      qs.length === 0 ||
      sharpenBusy ||
      Object.keys(state.sharpenSuggestions).length > 0
    ) {
      return;
    }
    setSharpenBusy(true);
    try {
      const res = await fetch("/api/try/sharpen-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: state.profile,
          questions: qs.map((q) => ({ id: q.id, question: q.question, why: q.why })),
        }),
      });
      const data = await readJson(res);
      const suggestions = (data?.suggestions ?? {}) as Record<string, string>;
      if (Object.keys(suggestions).length > 0) {
        setState((s) => ({ ...s, sharpenSuggestions: suggestions }));
      }
    } catch {
      // Non-fatal — the generic placeholder remains.
    } finally {
      setSharpenBusy(false);
    }
  }

  /**
   * Switches the questionnaire's display language. Translations are cached in
   * the funnel state per language, so this hits the API once and every later
   * toggle is instant and free. `lang === ""` restores the English originals,
   * which never left — only the display layer changes (see questionView), so
   * answers, de-duplication and the tailoring payload stay in English.
   */
  async function translateTo(lang: string) {
    if (!lang) {
      patch({ uiLang: "" });
      return;
    }
    if (state.translations[lang]) {
      patch({ uiLang: lang });
      return;
    }
    setTranslating(true);
    setError("");
    trackButtonClick({
      button_name: `translate_questions_${lang}`,
      action: "translate",
      button_text: `Translate questions to ${lang}`,
      click_source: "landing_try_now",
    });
    try {
      const items = [
        ...(state.mcq?.questions ?? []).map((q) => ({
          id: q.id,
          question: q.question,
          options: q.options,
        })),
        ...(state.questionnaire?.questions ?? []).map((q) => ({
          id: q.id,
          question: q.question,
          why: q.why,
          example: state.sharpenSuggestions[q.id] ?? "",
        })),
      ];
      const res = await fetch("/api/try/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang, items }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Translation failed");
      const map: Record<string, TranslatedQuestion> = {};
      for (const it of (data.items ?? []) as (TranslatedQuestion & {
        id: string;
      })[]) {
        map[it.id] = {
          question: it.question ?? "",
          why: it.why ?? "",
          options: it.options ?? [],
          example: it.example ?? "",
        };
      }
      setState((s) => ({
        ...s,
        uiLang: lang,
        translations: { ...s.translations, [lang]: map },
      }));
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Couldn't translate the questions"
      );
    } finally {
      setTranslating(false);
    }
  }

  function startOver() {
    if (!confirm("Start over? Your uploaded CV analysis and answers will be cleared.")) return;
    clearFunnel();
    setState(EMPTY_FUNNEL);
    setFile(null);
  }

  async function generateNow() {
    // Fold every questionnaire answer into the profile — the answers are
    // the whole point of the funnel.
    const profile = profileWithAnswers(state);
    if (!profile) return;
    setGenerateBusy(true);
    setError("");
    setQuotaMessage("");
    trackButtonClick({
      button_name: "anon_generate_cv",
      action: "generate",
      button_text: "Generate my tailored CV",
      click_source: "landing_try_now",
    });
    try {
      // Topic 1: generation cold starts (LLM overload / serverless warm-up)
      // make the first attempt fail intermittently. Silently retry transient
      // failures so the user never sees an error mid-loading — the spinner
      // ("Preparing your two files…") stays up across retries. Only a hard
      // failure after the whole budget is exhausted surfaces an error.
      const data = await generateWithRetry(profile, state.jdText);
      if (data.quota) {
        setQuotaMessage(
          data.quota ?? "Daily free limit reached. Please come back tomorrow."
        );
        return;
      }
      setState((s) => {
        const results = {
          cv: data.cv as TailoredCv,
          diff: data.diff,
          simulation: data.simulation ?? { pitch: "", questions: [] },
          jobTitle: data.jobTitle,
          company: data.company,
        };
        // Milestone 1: the initial AI generation becomes the "original" version.
        const version = makeVersion("original", {
          cv: results.cv,
          diff: results.diff,
          simulation: results.simulation,
          template: s.template,
        });
        return {
          ...s,
          results,
          reportStale: false,
          versions: appendVersion(s.versions, version),
        };
      });
      setRemaining(data.remaining ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setGenerateBusy(false);
    }
  }

  /** Questions done (answered or skipped) → results; generation starts.
   *  If this flow already produced a report, the user came back to edit a
   *  finished flow — confirm first (see confirmRegenerate). */
  function finishQuestions() {
    if (results) {
      setShowRegenConfirm(true);
      return;
    }
    // Freemium gate: guests register BEFORE seeing results. Their profile +
    // answers + JD are stashed and imported into Supabase after signup, which
    // lands them on the job's pricing/free-sample page (see /continue).
    if (!meta.registered) {
      goToSignup("questions_register");
      return;
    }
    if (signedIn) {
      goToImport("questions_import");
      return;
    }
    goTo("gate");
  }

  /** Confirmed regenerate: archive the finished flow as its own History row
   *  (kept intact), then start a fresh generation under a brand-new flow id. */
  function confirmRegenerate() {
    setShowRegenConfirm(false);
    if (state.profile) pushToHistory(state); // old report stays in History
    setState((s) => ({
      ...s,
      flowId: crypto.randomUUID(),
      results: null,
      downloadedCv: false,
      downloadedReport: false,
      // A brand-new flow starts its versioning + quotas from scratch.
      versions: [],
      rewritesUsed: 0,
      regensUsed: 0,
      reportStale: false,
      step: "gate",
      furthestStep: Math.max(s.furthestStep ?? 0, STEP_ORDER.indexOf("gate")),
    }));
    setEditing(false);
    setEditSnapshot(null);
    if (!meta.registered) generateNow();
  }

  /* ---------------- inline editing + AI rewrite (Results page) -------- */

  /** Realtime inline-edit persist: edits desync the report until regenerated. */
  function editCv(next: TailoredCv) {
    setState((s) =>
      s.results
        ? { ...s, results: { ...s.results, cv: next }, reportStale: true }
        : s
    );
  }

  /** §2.2 — Edit Mode enter/exit. Entering snapshots lastSavedState (the CV
   *  as it was when editing began); Done simply exits (saving is realtime). */
  function toggleEdit(next: boolean) {
    if (next && results) {
      setEditSnapshot({
        json: JSON.stringify(results.cv),
        cv: JSON.parse(JSON.stringify(results.cv)) as TailoredCv,
        reportStale: state.reportStale,
      });
    }
    if (!next) setEditSnapshot(null);
    setEditing(next);
  }

  /** §2.2 — Reset rolls back to the exact lastSavedState snapshot taken on
   *  entering Edit Mode, staying IN edit mode (§3.1 flow). Instant — no
   *  confirmation; the Undo toast is the safety net (PRD v2 Topic 6). */
  function resetCv() {
    if (!editSnapshot || !results) return;
    const undo = { cv: results.cv, reportStale: state.reportStale };
    setState((s) =>
      s.results
        ? {
            ...s,
            results: { ...s.results, cv: editSnapshot.cv },
            reportStale: editSnapshot.reportStale,
          }
        : s
    );
    setResetUndo(undo);
    if (resetToastTimer.current) clearTimeout(resetToastTimer.current);
    resetToastTimer.current = setTimeout(() => setResetUndo(null), 5000);
  }

  /** Reapply the state discarded by the last Reset (toast "Undo"). */
  function undoReset() {
    if (!resetUndo) return;
    setState((s) =>
      s.results
        ? {
            ...s,
            results: { ...s.results, cv: resetUndo.cv },
            reportStale: resetUndo.reportStale,
          }
        : s
    );
    if (resetToastTimer.current) clearTimeout(resetToastTimer.current);
    setResetUndo(null);
  }

  /** Rewrite a highlighted snippet — spends one rewrite from the flow quota. */
  async function handleRewrite(
    text: string,
    length: RewriteLength
  ): Promise<string> {
    if (state.rewritesUsed >= MAX_REWRITES) {
      throw new Error("Rewrite limit reached");
    }
    const res = await fetch("/api/try/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, length, jdText: state.jdText }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error ?? "Rewrite failed");
    setState((s) => ({ ...s, rewritesUsed: s.rewritesUsed + 1 }));
    return data.text as string;
  }

  /**
   * Rebuilds the interview report + change analysis around the EDITED CV
   * (never re-tailoring the CV). Records a "regenerate" milestone version.
   * Returns true on success. Bounded by MAX_REPORT_REGENS per flow.
   */
  async function regenerateReportNow(kind: VersionKind = "regenerate"): Promise<boolean> {
    if (!results || !state.profile) return false;
    if (state.regensUsed >= MAX_REPORT_REGENS) {
      setError(`You've used all ${MAX_REPORT_REGENS} report refreshes for this flow.`);
      return false;
    }
    setReportBusy(true);
    setError("");
    // Guide the eye to what is being rebuilt (PRD v2 Topic 8) — the report
    // sections fade via the reportBusy-driven classes below.
    reportSectionsRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    try {
      // §2.4 trace — the payload is the LATEST edited CV, not a stale copy.
      console.log(
        `[report-regen] sending edited CV: chars=${JSON.stringify(results.cv).length}`
      );
      const res = await fetch("/api/try/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cv: results.cv,
          jdText: state.jdText,
          baseCv: state.versions[0]?.cv,
          // Original uploaded-resume data — the Change Report's diff base.
          profile: profileWithAnswers(state) ?? undefined,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Report refresh failed");
      setState((s) => {
        if (!s.results) return s;
        const nextResults = {
          ...s.results,
          diff: data.diff,
          simulation: data.simulation ?? s.results.simulation,
          jobTitle: data.jobTitle || s.results.jobTitle,
          company: data.company || s.results.company,
        };
        const version = makeVersion(kind, {
          cv: nextResults.cv,
          diff: nextResults.diff,
          simulation: nextResults.simulation,
          template: s.template,
        });
        return {
          ...s,
          results: nextResults,
          regensUsed: s.regensUsed + 1,
          reportStale: false,
          versions: appendVersion(s.versions, version),
        };
      });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Report refresh failed");
      return false;
    } finally {
      setReportBusy(false);
    }
  }

  /** Restore a stored milestone version as the working CV + report. */
  function restoreVersion(v: CvVersion) {
    setState((s) =>
      s.results
        ? {
            ...s,
            template: v.template,
            results: {
              ...s.results,
              cv: v.cv,
              diff: v.diff,
              simulation: v.simulation ?? s.results.simulation,
            },
            reportStale: false,
          }
        : s
    );
  }

  /**
   * Smart download: if the CV was edited after the last report build, refresh
   * the report FIRST so the two files always match, then print. The actual
   * print fires from an effect once the regenerated report has rendered.
   */
  async function exportBoth() {
    trackButtonClick({
      button_name: "anon_export_bundle",
      action: "export",
      button_text: "Download my files",
      click_source: "landing_try_now",
    });
    if (state.reportStale && state.regensUsed < MAX_REPORT_REGENS) {
      await regenerateReportNow();
    }
    setPrintRequest(true);
  }

  function goToSignup(source: string) {
    if (!state.profile) return;
    trackButtonClick({
      button_name: source,
      action: "signup_gate",
      button_text: source,
      click_source: "landing_try_now",
    });
    stashForSignup(state);
    setLeaving(true);
    router.push("/login?next=/continue");
  }

  /**
   * Already signed in: skip the login step, but still import into Supabase.
   * Showing funnel results in place would leave the flow in localStorage
   * only — invisible to History and impossible to return to.
   */
  function goToImport(source: string) {
    if (!state.profile) return;
    trackButtonClick({
      button_name: source,
      action: "import_signed_in",
      button_text: source,
      click_source: "landing_try_now",
    });
    stashForSignup(state);
    setLeaving(true);
    router.push("/continue");
  }

  /* ---------------- derived ---------------- */
  const hasJob = state.jdText.trim().length >= 100;
  const stepIdx = STEP_ORDER.indexOf(state.step);

  /* ---------------- state-aware banner (§3) ---------------- */
  const banner = (() => {
    if (sim === "guest_with_profile" && state.profile) {
      return {
        cls: "border-green-100 bg-green-50 text-accent-deep",
        body: (
          <>
            <strong>We found ways to improve your CV!</strong> Register free
            to save your progress and see the results.
          </>
        ),
        action: (
          <Button size="sm" onClick={() => goToSignup("teaser_register")}>
            Register &amp; see results
          </Button>
        ),
      };
    }
    if (sim === "registered_no_profile") {
      return {
        cls: "border-border bg-chip text-ink-soft",
        body: (
          <>
            <strong className="text-ink">Welcome back!</strong> Your dashboard
            is empty — upload your CV and complete the quick questionnaire.
            Job matching and interview simulations unlock once your base
            profile exists.
          </>
        ),
        action: null,
      };
    }
    if (sim === "registered_with_profile" && state.profile && !hasJob) {
      return {
        cls: "border-green-100 bg-green-50 text-accent-deep",
        body: (
          <>
            <strong>Your profile is ready.</strong> Paste a job description to
            see your match — it unlocks the Job Match and Full Prep tiers.
          </>
        ),
        action: (
          <Button size="sm" onClick={() => goTo("upload")}>
            Add a job →
          </Button>
        ),
      };
    }
    if (sim === "paid_with_profile") {
      return {
        cls: "border-green-100 bg-green-50 text-accent-deep",
        body: (
          <>
            <strong>Full access active.</strong> Upload new jobs to generate
            more custom CVs and reports.
          </>
        ),
        action: (
          <Button size="sm" onClick={() => router.push("/demo")}>
            Open workspace →
          </Button>
        ),
      };
    }
    return null;
  })();

  /* ---------------- shared chrome ---------------- */
  const heroMode = state.step === "upload" && !meta.registered;

  // Clickable stepper: any step already reached can be revisited.
  const stepPills = state.profile && (
    <div className="mb-7 flex flex-wrap items-center justify-center gap-1.5">
      {STEP_ORDER.map((s, i) => {
        const status =
          s === state.step ? "active" : i < stepIdx ? "done" : "todo";
        const reachable = i <= (state.furthestStep ?? stepIdx);
        return (
          <button
            key={s}
            disabled={!reachable}
            onClick={() => reachable && goTo(s)}
            className={
              (status === "active"
                ? "rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-bold text-bg"
                : status === "done"
                  ? "rounded-full px-3 py-1.5 text-[12.5px] font-bold text-accent hover:bg-chip"
                  : "rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-muted") +
              (reachable ? " cursor-pointer" : " cursor-default")
            }
          >
            {status === "done" ? `✓ ${STEP_LABELS[s]}` : STEP_LABELS[s]}
          </button>
        );
      })}
    </div>
  );

  const bannerEl = banner && (
    <div
      className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[1.5px] px-4 py-3 text-[14.5px] ${banner.cls}`}
    >
      <p>{banner.body}</p>
      {banner.action}
    </div>
  );

  function BackButton({ to }: { to: FunnelStep }) {
    return (
      <Button variant="ghost" size="md" onClick={() => goTo(to)}>
        ← Back
      </Button>
    );
  }

  function Heading({ title, sub }: { title: string; sub: string }) {
    return (
      <div className="text-center">
        <h2 className="font-display text-[30px] font-extrabold tracking-tight text-ink">
          {title}
        </h2>
        <p className="mt-2 text-[15px] text-ink-soft">{sub}</p>
      </div>
    );
  }

  /* -------- upload card interior (shared by hero + step layouts) ------ */
  function uploadFields(cta: "dark" | "primary") {
    return (
      <>
        <div className="grid gap-5 sm:grid-cols-2">
          {/* 1 — CV upload (large, highlighted, drag-and-drop) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <StepNum n={1} />
              <span className="text-[15px] font-bold text-ink">
                Upload your CV
              </span>
            </div>
            <label
              onDragEnter={(e) => {
                e.preventDefault();
                if (!busy) setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!busy) setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!busy) acceptFile(e.dataTransfer.files?.[0]);
              }}
              className={`flex min-h-[210px] flex-1 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-[2.5px] border-dashed p-6 text-center transition-all ${
                dragOver
                  ? "scale-[1.01] border-accent bg-selected-bg ring-4 ring-accent/15"
                  : file
                    ? "border-accent bg-selected-bg"
                    : "border-dropzone-border bg-dropzone-bg hover:border-accent-soft hover:bg-selected-bg/60"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                disabled={busy}
                onChange={(e) => acceptFile(e.target.files?.[0])}
              />
              {file ? (
                <CheckCircle size={54} />
              ) : (
                <span className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-green-100 text-2xl font-extrabold text-accent-deep">
                  ↑
                </span>
              )}
              <span className="text-[17px] font-bold text-ink">
                {file
                  ? file.name
                  : dragOver
                    ? "Drop your file to upload"
                    : "Drag & drop your CV here"}
              </span>
              <span className="text-[14px] text-ink-faint">
                {file ? "Click or drop to replace" : "or click to browse · PDF or DOCX"}
              </span>
            </label>
          </div>

          {/* 2 — Job description (large rectangular text box) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <StepNum n={2} />
              <span className="text-[15px] font-bold text-ink">
                Paste the job description
              </span>
            </div>
            <Textarea
              rows={9}
              className="min-h-[210px] flex-1 resize-none rounded-lg border-2 text-[15px] leading-relaxed"
              placeholder={
                "--- Copied from LinkedIn ---\nSenior Product Manager, Growth\nTel Aviv · Hybrid\nWe're looking for a PM to own our activation funnel end-to-end…"
              }
              value={state.jdText}
              onChange={(e) => patch({ jdText: e.target.value })}
            />
          </div>
        </div>
        {file && state.jdText.trim().length > 0 && !hasJob && (
          <p className="text-center text-[13px] text-ink-faint">
            Paste a bit more of the job posting (min. 100 characters)
          </p>
        )}
        {/* 3 — Analyze */}
        <div className="flex items-stretch gap-3">
          <div className="flex items-center">
            <StepNum n={3} />
          </div>
          <Button
            variant={cta === "dark" ? "dark" : "primary"}
            size="lg"
            className="flex-1 text-[16px]"
            style={{ paddingTop: 14, paddingBottom: 14 }}
            disabled={!file || !hasJob || busy}
            onClick={analyze}
          >
            {busy ? (
              <Spinner label="Analyzing your CV… (up to a minute)" />
            ) : (
              "Analyze my CV — free"
            )}
          </Button>
        </div>
        {state.profile && (
          <p className="text-center text-[13px] text-ink-faint">
            You have an analysis in progress
            {state.profile.contact.fullName
              ? ` for ${state.profile.contact.fullName}`
              : ""}
            .{" "}
            <button
              className="cursor-pointer font-semibold text-accent underline"
              onClick={() => goTo(hasJob ? "gate" : "chat")}
            >
              Continue where you left off
            </button>
          </p>
        )}
      </>
    );
  }

  if (leaving) {
    return (
      <div className="mx-auto max-w-[720px] px-6">
        <Card className="p-10 text-center">
          <Spinner label="Taking you to sign-in… your progress is saved." />
        </Card>
      </div>
    );
  }

  /* ================= HERO layout (landing, mock 2c) ================= */
  if (heroMode) {
    return (
      <section className="mx-auto grid max-w-[1320px] items-center gap-8 px-6 pb-4 pt-8 sm:px-14 lg:min-h-[calc(100vh-88px)] lg:grid-cols-[1fr_600px] lg:gap-14 lg:pt-4">
        <div className="flex flex-col gap-[22px]">
          {bannerEl}
          <h1 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink [text-wrap:balance] sm:text-[60px]">
            Your CV, rewritten for{" "}
            <span className="marker-highlight">this job</span>. Not every job.
          </h1>
          <p className="max-w-[460px] text-lg leading-[1.55] text-ink-soft">
            Add your CV and the job you want. We ask a few short questions,
            then give you a one-page CV that matches what this employer is
            looking for.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3.5">
            <Button
              size="lg"
              onClick={() => {
                // Straight to business: open the OS file dialog.
                uploadCardRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                });
                fileInputRef.current?.click();
              }}
            >
              Get started →
            </Button>
            {state.profile && (
              <Button
                variant="outline"
                size="lg"
                onClick={() =>
                  goTo(STEP_ORDER[state.furthestStep ?? 0] ?? "upload")
                }
              >
                Continue progress →
              </Button>
            )}
            <span className="text-sm text-ink-faint">
              Takes about a minute
            </span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {["Never invents facts", "Shows every change", "Strictly one page"].map(
              (t) => (
                <span
                  key={t}
                  className="rounded-full bg-chip px-[15px] py-[7px] text-[13.5px] font-semibold text-ink-soft"
                >
                  ✓ {t}
                </span>
              )
            )}
          </div>
        </div>

        <div ref={uploadCardRef}>
          <Card className="flex flex-col gap-3.5 p-7">
            <div className="text-[17px] font-bold text-ink">
              Start here
            </div>
            {uploadFields("dark")}
          </Card>
          {error && (
            <p className="mt-3 text-center text-sm text-red-700">{error}</p>
          )}
        </div>
      </section>
    );
  }

  /* ================= FUNNEL layout (mocks 3a-3e) ================= */
  const wideResults =
    state.step === "gate" && !meta.registered && Boolean(results);
  return (
    <section
      className={`mx-auto px-6 pt-4 ${
        wideResults
          ? "max-w-[1200px]"
          : state.step === "chat"
            ? "max-w-[960px]"
            : "max-w-[720px]"
      }`}
    >
      {stepPills}
      {bannerEl}

      {/* ============ 1. Upload CV + paste job (3a) ============ */}
      {state.step === "upload" && (
        <div className="flex flex-col gap-5">
          <Heading
            title={
              meta.registered
                ? "Build your base profile"
                : "Start here"
            }
            sub="Your CV and the job you want — we need both to ask only the questions that matter."
          />
          <Card className="flex flex-col gap-3.5 p-7">{uploadFields("primary")}</Card>
          <p className="text-center text-[13px] text-ink-faint">
            Takes about a minute
          </p>
        </div>
      )}

      {/* ======= 2. Unified conversational questions (PRD Topic 2) ======= */}
      {state.step === "chat" && (
        <div className="flex flex-col gap-5">
          <Heading
            title={
              state.profile?.contact.fullName
                ? `Let's tailor your CV, ${state.profile.contact.fullName.split(" ")[0]}.`
                : "Let's tailor your CV to this job."
            }
            sub="Answer the required questions to unlock your reports — then sharpen with a few optional ones."
          />
          <ChatFlow
            state={state}
            registered={meta.registered}
            onUpdateMcq={updateMcqAnswer}
            onSkipMcq={(id) => setMcqSkipped(id, true)}
            onAnswerOpen={answerOpen}
            onClearAutoFilled={clearAutoFilled}
            onLoadRole={loadRoleQuestions}
            loadingRole={loadingMore}
            sharpenBusy={sharpenBusy}
            onGenerate={finishQuestions}
            generateBusy={generateBusy}
            onBack={() => goTo("upload")}
            onGreetingReply={(reply) =>
              patch({ greetingReply: reply, greetingDone: true })
            }
            onBranch={(choice) => {
              trackButtonClick({
                button_name: `chat_branch_${choice}`,
                action: "navigate",
                button_text:
                  choice === "continue" ? "Continue" : "Generate CV and report",
                click_source: "landing_try_now",
              });
              patch({ branchChoice: choice });
            }}
            onBranchStart={() => patch({ branchStarted: true })}
            onTranslate={translateTo}
            translating={translating}
          />
        </div>
      )}

      {/* ============ 4. Results — V1 public launch: free, no account ==== */}
      {state.step === "gate" && !meta.registered && !results && (
        <div className="mx-auto flex max-w-[560px] flex-col items-center gap-[18px] text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <CheckCircle />
          </span>
          <h2 className="font-display text-[32px] font-extrabold tracking-tight text-ink [text-wrap:balance]">
            {generateBusy
              ? "Preparing your two files…"
              : "Ready to see your tailored CV"}
          </h2>
          <p className="text-[15.5px] leading-[1.55] text-ink-soft">
            A one-page CV made for this job, plus an interview report with the
            questions you are likely to be asked.
          </p>
          {quotaMessage && (
            <div className="w-full rounded-2xl border-[1.5px] border-border bg-chip px-5 py-4 text-[14px] text-ink-soft">
              {quotaMessage}
            </div>
          )}
          {generateBusy ? (
            <div className="rounded-2xl border-[1.5px] border-border bg-card px-6 py-4">
              <Spinner label="Building your CV and report… (30–90 seconds)" />
            </div>
          ) : (
            <Button size="lg" onClick={generateNow}>
              Generate my two files →
            </Button>
          )}
          <p className="text-[12.5px] text-muted">
            Everything you told us is saved on{" "}
            <Link href="/card" className="font-bold text-accent underline">
              My card
            </Link>
            .
          </p>
          <div className="flex items-center gap-3">
            <BackButton to="chat" />
            <button
              className="cursor-pointer text-[13px] text-muted underline transition-colors hover:text-ink-soft"
              onClick={startOver}
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {state.step === "gate" && !meta.registered && results && (
        <div className="flex flex-col gap-6">
          {/* Register-to-save gate — persists this run into the user's account
              (Supabase) via /continue → /api/try/import. */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-[1.5px] border-green-100 bg-green-50 px-5 py-4 text-[14.5px] text-accent-deep print:hidden">
            <p>
              <strong>Love your new CV?</strong> Register free to save it to
              your account and unlock job-by-job tailoring.
            </p>
            <Button size="md" onClick={() => goToSignup("results_register")}>
              Register free to save →
            </Button>
          </div>
          {/* ---- 1. Tailored CV ---- */}
          <div>
            <div className="text-center">
              <h2 className="font-display text-xl font-extrabold text-ink">
                {results.jobTitle || "Your tailored CV"}
                {results.company && (
                  <span className="font-sans text-base font-normal text-ink-soft">
                    {" "}
                    · {results.company}
                  </span>
                )}
              </h2>
            </div>
            <div className="mb-3 mt-3 flex flex-col gap-3 print:hidden">
              {/* Design catalog — 3 rows (Recommended / Classic / Modern),
                  each design viewable on a light or dark background. */}
              <div data-tour="design">
                <p className="mb-1.5 text-xs font-semibold text-ink-faint">
                  Choose a design
                </p>
                <TemplateCatalog
                  template={template}
                  onSelect={(t) => patch({ template: t })}
                  jdText={state.jdText}
                />
              </div>
              {/* Primary action — deliberately alone, above the preview frame
                  (the operational controls live on the frame's toolbar) */}
              <div ref={downloadAnchorRef} className="flex items-center justify-end">
                <Button
                  data-tour="download"
                  size="md"
                  disabled={reportBusy || editing}
                  title={
                    editing
                      ? "Finish editing (Done) to download"
                      : undefined
                  }
                  onClick={exportBoth}
                >
                  {reportBusy ? "Syncing report…" : downloadLabel}
                </Button>
              </div>
              {/* The interview simulation is the whole second file. When the
                  model returned none, say so and offer the rebuild instead of
                  handing over a report file with its main section missing. */}
              {simulationMissing && !editing && (
                <div className="flex flex-wrap items-center justify-end gap-2 text-[12px] text-ink-faint">
                  <span>
                    Your interview simulation didn’t come through — rebuild it
                    to get the full report.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={reportBusy || state.regensUsed >= MAX_REPORT_REGENS}
                    onClick={() => regenerateReportNow()}
                  >
                    {reportBusy ? "Rebuilding…" : "Rebuild my report"}
                  </Button>
                </div>
              )}
              {state.reportStale && !editing && (
                <p className="text-[11px] text-ink-faint">
                  You edited your CV — the interview report will refresh
                  automatically when you download, or refresh it now.
                </p>
              )}
            </div>
            {editing && (
              <p className="mb-2 text-center text-xs font-semibold text-accent print:hidden">
                ✎ Edit Mode — click any text to edit it, highlight a phrase for
                an AI rewrite. Realtime-saved; Done exits.
              </p>
            )}
            <div
              className={`overflow-hidden rounded-2xl border transition-all duration-200 print:border-0 ${
                editing
                  ? "border-accent ring-2 ring-accent/30"
                  : "border-border"
              }`}
            >
              {/* Operational controls, anchored to the preview (PRD Topic 3) */}
              <CvToolbar>
                <span data-tour="edit" className="inline-flex">
                  <EditToolbar
                    editing={editing}
                    onToggleEdit={toggleEdit}
                    onReset={resetCv}
                    canReset={isDirty}
                  />
                </span>
                <span data-tour="ai-section" className="inline-flex">
                  <AiSectionToggle cv={results.cv} onChange={editCv} />
                </span>
                <RefreshReportButton
                  onClick={() => regenerateReportNow()}
                  disabled={
                    editing ||
                    reportBusy ||
                    !state.reportStale ||
                    state.regensUsed >= MAX_REPORT_REGENS
                  }
                  busy={reportBusy}
                  stale={state.reportStale}
                  editing={editing}
                />
                <ToolbarDivider />
                <DisplayReviewButton
                  onClick={() => setFullScreen(true)}
                  disabled={editing}
                />
                <span data-tour="split" className="inline-flex">
                  <SplitToggle
                    template={template}
                    split={splitView}
                    onToggle={setSplitView}
                  />
                </span>
                {/* View settings grouped together (PRD v2 Topic 5). */}
                <span data-tour="theme" className="inline-flex">
                  <ThemeToggle theme={cvTheme} onChange={setCvTheme} />
                </span>
              </CvToolbar>
              <div
                ref={cvPreviewRef}
                /* cv-print-reset guards the print path: nothing here may
                   become the containing block of the absolutely-positioned
                   .cv-page, or the exported CV prints blank (globals.css). */
                className="cv-print-reset overflow-auto bg-chip p-4 print:bg-white print:p-0"
              >
                <CvRenderer
                  cv={results.cv}
                  template={template}
                  theme={cvTheme}
                  split={shownSplit}
                  editable={editing}
                  onChange={editCv}
                />
              </div>
            </div>
            <RewriteTooltip
              containerRef={cvPreviewRef}
              enabled={editing}
              rewritesUsed={state.rewritesUsed}
              maxRewrites={MAX_REWRITES}
              onRewrite={handleRewrite}
            />
            <p className="mt-3 text-center text-xs text-ink-faint print:hidden">
              {remaining !== null
                ? `${remaining} free CV${remaining === 1 ? "" : "s"} left today.`
                : ""}
            </p>
          </div>

          {/* ---- 2-4. Report sections — faded + inert while refreshing ---- */}
          <div
            ref={reportSectionsRef}
            className={`flex scroll-mt-20 flex-col gap-6 transition-opacity duration-300 ${
              reportBusy ? "pointer-events-none select-none opacity-25" : ""
            }`}
            aria-busy={reportBusy}
          >
          {/* ---- 2. Match analysis ---- */}
          <Card className="p-6 print:hidden">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-ink">Match analysis</h3>
              <span className="font-display text-2xl font-extrabold text-accent">
                {results.diff.gapAnalysis.matchScore}%
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-chip">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${results.diff.gapAnalysis.matchScore}%` }}
              />
            </div>
            <div className="mt-2 grid gap-x-8 sm:grid-cols-2">
              <div>
                {results.diff.gapAnalysis.strengths.length > 0 && (
                  <>
                    <h4 className="mt-2 text-xs font-bold uppercase text-accent">
                      Strengths
                    </h4>
                    <ul className="mt-1 list-disc pl-4 text-sm text-ink-soft">
                      {results.diff.gapAnalysis.strengths.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div>
                {results.diff.gapAnalysis.gaps.length > 0 && (
                  <>
                    <h4 className="mt-2 text-xs font-bold uppercase text-red-700">
                      Gaps
                    </h4>
                    <ul className="mt-1 list-disc pl-4 text-sm text-ink-soft">
                      {results.diff.gapAnalysis.gaps.map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
            {results.diff.gapAnalysis.recommendations.length > 0 && (
              <>
                <h4 className="mt-3 text-xs font-bold uppercase text-accent">
                  Recommendations
                </h4>
                <ul className="mt-1 list-disc pl-4 text-sm text-ink-soft">
                  {results.diff.gapAnalysis.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </Card>

          {/* ---- 3. Interview simulation (clean, text-only) ---- */}
          {(results.simulation.pitch ||
            results.simulation.questions.length > 0) && (
            <Card className="p-6 print:hidden">
              <h3 className="font-bold text-ink">Interview simulation</h3>
              {results.simulation.pitch && (
                <div className="mt-3 rounded-[14px] bg-green-50 p-3 text-sm text-accent-deep">
                  <p className="text-xs font-bold uppercase">Your 30-second pitch</p>
                  <p className="mt-1 italic">“{results.simulation.pitch}”</p>
                </div>
              )}
              <div className="mt-3 space-y-3">
                {results.simulation.questions.map((q, i) => {
                  const tone = TONE_META[q.tone] ?? TONE_META.curious;
                  return (
                    <div
                      key={i}
                      className="rounded-[14px] border border-border p-3 text-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <span
                          className="rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white"
                          style={{ background: tone.chip }}
                        >
                          {tone.label}
                        </span>
                        <span className="ml-2 text-[11px] italic text-ink-faint">
                          {tone.hint}
                        </span>
                        <p className="mt-1 font-semibold text-ink">{q.question}</p>
                        {q.whyTheyAsk && (
                          <p className="mt-1 text-xs italic text-ink-faint">
                            Why they ask: {q.whyTheyAsk}
                          </p>
                        )}
                        {q.howToAnswer && (
                          <p className="mt-1.5 text-[13px] text-ink-soft">
                            {q.howToAnswer}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ---- 4. Change report ---- */}
          <Card className="p-6 print:hidden">
            <h3 className="font-bold text-ink">Change report</h3>
            <div className="mt-3 space-y-3">
              {results.diff.changes.map((c, i) => (
                <div key={i} className="rounded-[14px] border border-border p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                    {c.section} · {c.type}
                  </p>
                  <DiffChangeLines change={c} />
                  {c.reason && (
                    <p className="mt-1.5 text-xs italic text-ink-faint">{c.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
          </div>

          {/* ---- 5. Version history (milestone snapshots) ---- */}
          {state.versions.length > 1 && (
            <Card className="p-6 print:hidden">
              <VersionStrip
                versions={state.versions}
                onRestore={restoreVersion}
              />
            </Card>
          )}

          {/* Printable simulation report — hidden on screen, becomes the
              second deliverable file of the download bundle */}
          <ReportPage
            results={results}
            candidateName={state.profile?.contact.fullName || ""}
          />
        </div>
      )}

      {state.step === "gate" && sim === "registered_no_profile" && (
        <Card className="p-7 text-center">
          <p className="text-[15px] text-ink-soft">
            Your base profile isn&apos;t ready yet — upload your CV and
            complete the questionnaire first.
          </p>
          <Button className="mt-4" onClick={() => goTo("upload")}>
            Build my profile
          </Button>
        </Card>
      )}

      {state.step === "gate" && sim === "registered_with_profile" && (
        <div className="flex flex-col gap-[18px]">
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Badge tone="amber">Simulator: Registered + Profile</Badge>
          </div>
          <Heading
            title="Choose what to generate"
            sub={`Your profile${hasJob ? " and job are" : " is"} ready. Pick a tier — your documents are generated right after payment.`}
          />
          <Paywall
            hasJob={hasJob}
            onSelect={() => router.push("/demo")}
            onAddJob={() => goTo("upload")}
          />
          <div>
            <BackButton to="chat" />
          </div>
        </div>
      )}

      {state.step === "gate" && sim === "paid_with_profile" && (
        <div className="mx-auto flex max-w-[560px] flex-col items-center gap-[18px] text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <CheckCircle />
          </span>
          <h2 className="font-display text-[32px] font-extrabold tracking-tight text-ink">
            You have full access
          </h2>
          <p className="text-[15.5px] leading-[1.55] text-ink-soft">
            Your payment is active for this job — head to the workspace to
            review, edit, approve and download your documents.
          </p>
          <Button size="lg" onClick={() => router.push("/demo")}>
            Open the workspace (demo) →
          </Button>
          <BackButton to="chat" />
        </div>
      )}

      {error && (
        <p className="mt-3 text-center text-sm text-red-700">{error}</p>
      )}

      <Modal
        open={showRegenConfirm}
        onClose={() => setShowRegenConfirm(false)}
        title="Generate an updated report?"
      >
        <p className="text-[14.5px] leading-relaxed text-ink-soft">
          You already generated a CV and report for this flow. Confirming will
          build a new, updated version from your latest answers — your previous
          version stays saved as its own entry in your{" "}
          <Link href="/history" className="font-bold text-accent underline">
            History
          </Link>
          .
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button variant="ghost" onClick={() => setShowRegenConfirm(false)}>
            Cancel — keep editing
          </Button>
          <Button onClick={confirmRegenerate}>Generate updated report →</Button>
        </div>
      </Modal>

      {/* First-visit guided tour of the Results controls (PRD v2 Topic 4) */}
      {showTour && resultsShown && (
        <ResultsTour steps={RESULTS_TOUR_STEPS} onClose={endTour} />
      )}

      {resetUndo && (
        <Toast message="Edits discarded" actionLabel="Undo" onAction={undoReset} />
      )}

      {/* Floating Download — appears only once the original scrolls out of
          view; same handler + disabled states (PRD v2 Topic 9). Sits above
          content but below every overlay (tooltip 60 / fullscreen 70). */}
      {downloadFloating && resultsShown && (
        <div className="fixed right-6 top-20 z-40 print:hidden">
          <Button
            size="md"
            disabled={reportBusy || editing}
            title={editing ? "Finish editing (Done) to download" : undefined}
            onClick={exportBoth}
            className="shadow-[0_12px_32px_rgba(30,43,36,0.28)]"
          >
            {reportBusy ? (
              "Syncing report…"
            ) : (
              <>
                <span className="hidden sm:inline">{downloadLabel}</span>
                <span className="sm:hidden">Download</span>
              </>
            )}
          </Button>
        </div>
      )}

      {fullScreen && results && (
        <FullScreenCv
          cv={results.cv}
          template={template}
          theme={cvTheme}
          split={shownSplit}
          onClose={() => setFullScreen(false)}
        />
      )}
    </section>
  );
}

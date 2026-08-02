"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import {
  MAX_ASKED_MCQ,
  MAX_ASKED_OPEN,
  MAX_REPORT_REGENS,
  MAX_REWRITES,
  MasterProfile,
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
  JobDraft,
  MIN_JD_CHARS,
  McqAnswer,
  STEP_ORDER,
  capQuestionPools,
  clearFunnel,
  emptyJobDraft,
  ensureAiToolOptions,
  isJobReady,
  isMcqAnswered,
  loadFunnel,
  normalizeMcqPool,
  primaryJd,
  profileWithAnswers,
  pushToHistory,
  readyJobs,
  saveFunnel,
  stampAnswerTime,
  stashForSignup,
} from "@/lib/funnel";
import { MAX_PACK_SIZE } from "@/lib/packs";
import {
  BaseCvMeta,
  fetchAccountPrefs,
  preferredExportPrefs,
  rememberExportPrefs,
  saveAccountPrefs,
} from "@/lib/prefs";
import { readAiSectionPref } from "@/lib/export-prefs";
import { findCachedAnswers } from "@/lib/answer-cache";
import { EMPTY_MATCH, MatchedAnswers, mergeMatches } from "@/lib/answer-match";
import { printBoth, printFile } from "@/lib/download";
import { simMeta, useSimUser } from "@/lib/sim-user";
import { useSession } from "@/lib/use-session";
import {
  Badge,
  Button,
  Card,
  Input,
  Modal,
  Spinner,
  Textarea,
  Toast,
} from "@/components/ui";
import { ReportSectionsSkeleton } from "@/components/skeleton";
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
  upload: "CV + Jobs",
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
  /** The CV extraction is running in the background (stage 1). */
  const [cvBusy, setCvBusy] = useState(false);
  /**
   * In-flight CV parse, keyed by which CV it is for. Holding the promise (not
   * a flag) lets a later caller await the same request instead of starting a
   * second extraction of the same document.
   */
  const cvParse = useRef<{ key: string; promise: Promise<ParsedCv> } | null>(
    null
  );
  /**
   * The job the user explicitly opened. Null means "whatever still needs
   * filling in" — see `expandedJob` below, which is derived rather than
   * stored so a restored flow reopens its unfinished card without an effect.
   */
  const [openedJob, setOpenedJob] = useState<string | null>(null);
  /** The CV picker is showing even though a CV is already parsed. */
  const [cvOpen, setCvOpen] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const uploadCardRef = useRef<HTMLDivElement>(null);

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
  // Rebuilding the interview report around the edited CV.
  const [reportBusy, setReportBusy] = useState(false);
  // Deferred print request — the print fires from an effect so the DOM it
  // captures is the one React has already committed.
  const [printRequest, setPrintRequest] = useState(false);
  // True from the click until the last print dialog has been handed over.
  // A ref as well as state: `window.print()` blocks, and every click made
  // while a dialog was open is replayed on dismiss — the ref rejects those
  // replays synchronously, before React can re-render the disabled button.
  const [printing, setPrinting] = useState(false);
  const exportInFlight = useRef(false);
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

  /**
   * Account-level preferences: the design last downloaded and the base CV on
   * file. The local preference wins when present (it is this device's most
   * recent truth); the account fills in on a fresh device, which is what makes
   * the chosen design and the saved CV follow the user at all.
   */
  const [savedCv, setSavedCv] = useState<BaseCvMeta | null>(null);
  const [useSavedCv, setUseSavedCv] = useState(false);
  // Derived rather than reset on sign-out: a signed-out user has no base CV
  // regardless of what the last fetch found.
  const baseCv = signedIn ? savedCv : null;
  /** A CV is chosen: freshly picked, or the one on the account. Declared here
   *  rather than with the other derived values because the effect that opens
   *  stage 2 depends on it. */
  const hasCvReady = file !== null || (useSavedCv && baseCv !== null);
  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    void fetchAccountPrefs().then((prefs) => {
      if (!alive || !prefs) return;
      setSavedCv(prefs.baseCv);
      // Pre-select it: a returning user's common case is "same CV, new job".
      setUseSavedCv(prefs.baseCv !== null);
      // …and open the first job card, since stage 1 is already satisfied.
      // The CV itself is NOT parsed here: a returning user passing through the
      // homepage should not cost an extraction. commitJob starts it once they
      // actually file their first job away.
      if (prefs.baseCv !== null) openFirstJob();
      // Merge per SETTING, local winning: this device's last download is the
      // most recent truth, and the account fills in whatever it never saw.
      const local = preferredExportPrefs();
      rememberExportPrefs({ ...prefs.export, ...local });
      // Push local up when the account has nothing yet — someone who
      // downloaded as a guest and then registered has their whole
      // configuration only in localStorage, and the sync was one-way, so
      // their first account generation would have ignored it.
      if (!prefs.export.template && local.template) {
        void saveAccountPrefs({ export: local });
      }
    });
    return () => {
      alive = false;
    };
  }, [signedIn]);
  useEffect(() => {
    if (hydrated) saveFunnel(state);
  }, [state, hydrated]);

  // Every step transition starts at the top of the page — otherwise a long
  // step (e.g. the quick check) leaves the next step scrolled halfway down.
  useEffect(() => {
    if (hydrated) window.scrollTo({ top: 0 });
  }, [state.step, hydrated]);

  // Deferred print: runs once the requested files have rendered. Records the
  // "download" milestone version.
  useEffect(() => {
    if (!printRequest || reportBusy) return;
    // The configuration the user actually downloaded in becomes their default
    // for every future flow (both stores; the account copy follows them across
    // devices). This used to save the design alone, so a Ledger + dark + split
    // download came back as Ledger + light + no split. Non-fatal by design — a
    // failed preference write must never interfere with a print dialog.
    const exportPrefs = {
      template: state.template,
      cvTheme: state.cvTheme,
      // The raw toggle, not `shownSplit` — see export-prefs.ts.
      splitView: state.splitView,
      ...(() => {
        const hide = state.results
          ? readAiSectionPref(state.results.cv)
          : undefined;
        return hide === undefined ? {} : { hideAiSection: hide };
      })(),
    };
    rememberExportPrefs(exportPrefs);
    if (signedIn) void saveAccountPrefs({ export: exportPrefs });
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
    const job =
      state.results && state.results.simulation.questions.length === 0
        ? Promise.resolve(printFile("cv", meta))
        : printBoth(meta);
    // The button stays busy until the last dialog has been handed over, so a
    // second click cannot stack another burst of dialogs behind this one.
    void job.finally(() => {
      exportInFlight.current = false;
      setPrinting(false);
    });
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
    setUseSavedCv(false);
    openFirstJob();
    // Read the CV straight away rather than waiting for a submit click: the
    // extraction is a 30-60s LLM call, and the user is about to spend that
    // long pasting their first job description anyway.
    void parseCv({ kind: "file", file: f }).catch(() => {});
  }

  /**
   * Stage 2 opens the moment a CV is chosen: the flow is strictly sequential,
   * so there is exactly one empty job card waiting and nothing else. Called
   * from the CV-choice handlers rather than an effect — the card appearing is
   * a response to that click, not a synchronisation with anything external.
   */
  function openFirstJob() {
    const draft = emptyJobDraft();
    setState((s) => (s.jobs.length > 0 ? s : { ...s, jobs: [draft] }));
  }

  /* ---------------- CV parsing (stage 1) ---------------- */

  type CvSource = { kind: "file"; file: File } | { kind: "saved" };
  type ParsedCv = { profile: MasterProfile; rawText: string };

  function sourceKey(s: CvSource): string {
    return s.kind === "file"
      ? `file:${s.file.name}:${s.file.size}:${s.file.lastModified}`
      : "saved";
  }

  /**
   * Parse the chosen CV, at most once per CV.
   *
   * Kicked off eagerly the moment a CV is chosen and awaited again when the
   * user continues, so the common case has the profile ready before they ask
   * for it and the impatient case simply waits on the same request. The ref
   * holds the in-flight promise (not a boolean) precisely so the second caller
   * joins the first rather than firing a duplicate extraction — and it
   * RESOLVES with the profile, so that caller never has to read it back out of
   * a setState that has not committed yet.
   */
  function parseCv(source: CvSource): Promise<ParsedCv> {
    const key = sourceKey(source);
    const pending = cvParse.current;
    if (pending?.key === key) return pending.promise;
    const promise = runParseCv(source).catch((e) => {
      // Clear the cache so the user can retry the same CV after a failure.
      if (cvParse.current?.key === key) cvParse.current = null;
      throw e;
    });
    cvParse.current = { key, promise };
    return promise;
  }

  async function runParseCv(source: CvSource): Promise<ParsedCv> {
    setCvBusy(true);
    setError("");
    trackButtonClick({
      button_name: "try_now_parse_cv",
      action: "upload",
      button_text: "Upload CV",
      click_source: "landing_try_now",
    });
    try {
      const form = new FormData();
      // The saved CV is already on the account as extracted text, so the
      // server reads it from there — the user never re-picks the same file.
      if (source.kind === "saved") form.append("useSaved", "1");
      else form.append("file", source.file);
      /**
       * No `jd` is sent. The questionnaire this route can build is tied to one
       * job description, and the flow now collects several before asking
       * anything — /api/try/questions builds the merged set once every job is
       * in. What we need here is the profile and the raw text.
       */
      const res = await fetch("/api/try/parse-cv", { method: "POST", body: form });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      // Keep the freshly uploaded CV on the account so the next session can
      // offer it back. Best-effort: this must not fail an otherwise good run.
      if (signedIn && source.kind === "file" && data.rawText) {
        void saveAccountPrefs({
          baseCv: { rawText: data.rawText, fileName: source.file.name },
        });
        setSavedCv({
          fileName: source.file.name,
          uploadedAt: new Date().toISOString(),
        });
      }
      const seededExport = preferredExportPrefs();
      setState((s) => {
        // A new CV starts a NEW flow — the previous one is archived to
        // History, never overwritten. The job drafts are the exception: the
        // user typed those, and they apply to whichever CV is on the desk.
        if (s.profile) pushToHistory(s);
        return {
          ...s,
          flowId: crypto.randomUUID(),
          profile: data.profile,
          rawText: data.rawText ?? "",
          // Rebuilt from every job by /api/try/questions when the user
          // continues; a stale pool here would flash the previous CV's
          // questions if they walked back to the chat step.
          questionnaire: null,
          mcq: null,
          mcqAnswers: {},
          answers: {},
          answerTimes: {},
          autoFilledIds: [],
          knownIds: [],
          processName: "",
          roleQuestionsLoaded: false,
          mcqIndex: 0,
          // A fresh flow opens in the configuration the user last downloaded,
          // not the hardcoded EMPTY_FUNNEL defaults — that reset is what forced
          // users with a consistent visual identity to redo their whole export
          // setup on every application. (The AI-section choice is not here: it
          // lives inside the CV's own hiddenSectionIds, applied in generateNow.)
          template: seededExport.template ?? EMPTY_FUNNEL.template,
          cvTheme: seededExport.cvTheme ?? EMPTY_FUNNEL.cvTheme,
          splitView: seededExport.splitView ?? EMPTY_FUNNEL.splitView,
          results: null,
          downloadedCv: false,
          downloadedReport: false,
          versions: [],
          rewritesUsed: 0,
          regensUsed: 0,
          reportStale: false,
          sharpenSuggestions: {},
          greetingInfo: null,
          greetingReply: "",
          greetingDone: false,
          branchChoice: "",
          branchStarted: false,
        };
      });
      return { profile: data.profile, rawText: data.rawText ?? "" };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      throw e;
    } finally {
      setCvBusy(false);
    }
  }

  /* ---------------- job drafts (stage 2) ---------------- */

  function patchJob(key: string, next: Partial<JobDraft>) {
    setState((s) => ({
      ...s,
      jobs: s.jobs.map((d) => (d.key === key ? { ...d, ...next } : d)),
    }));
  }

  function addJob() {
    const draft = emptyJobDraft();
    setState((s) => ({ ...s, jobs: [...s.jobs, draft] }));
    setOpenedJob(draft.key);
  }

  function removeJob(key: string) {
    setState((s) => ({ ...s, jobs: s.jobs.filter((d) => d.key !== key) }));
    setOpenedJob((k) => (k === key ? null : k));
  }

  /**
   * Read the hiring company and job title off a pasted JD.
   *
   * Fires on blur rather than while typing: one call per job description
   * instead of one per keystroke-pause, and the user has finished pasting by
   * the time they leave the field. Never overwrites something the user typed.
   */
  const lookUpJobMeta = useCallback(async (draft: JobDraft) => {
    const jd = draft.jdText.trim();
    if (jd.length < MIN_JD_CHARS || draft.lookedUpFor === jd) return;
    setState((s) => ({
      ...s,
      jobs: s.jobs.map((d) =>
        d.key === draft.key ? { ...d, looking: true, lookedUpFor: jd } : d
      ),
    }));
    try {
      const res = await fetch("/api/try/jd-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText: jd }),
      });
      const data = await readJson(res);
      setState((s) => ({
        ...s,
        jobs: s.jobs.map((d) =>
          d.key === draft.key
            ? {
                ...d,
                looking: false,
                company: d.company.trim() || (data?.company ?? ""),
                title: d.title.trim() || (data?.title ?? ""),
              }
            : d
        ),
      }));
    } catch {
      // The user can always type the name — a failed lookup is not an error
      // worth showing, it just leaves the field empty and required.
      setState((s) => ({
        ...s,
        jobs: s.jobs.map((d) =>
          d.key === draft.key ? { ...d, looking: false } : d
        ),
      }));
    }
  }, []);

  /** Leaving a job's textarea collapses it to a chip and names it. */
  function commitJob(draft: JobDraft) {
    if (!isJobReady(draft)) return;
    patchJob(draft.key, { committed: true });
    setOpenedJob((k) => (k === draft.key ? null : k));
    void lookUpJobMeta(draft);
    // A returning user's saved CV is pre-selected but deliberately unparsed
    // until now — filing a job away is the first real sign they mean to run
    // this flow, and it leaves the extraction time to overlap with the jobs
    // they add next rather than landing entirely on the Continue click.
    if (!state.profile && !cvBusy && hasCvReady) {
      void parseCv(file ? { kind: "file", file } : { kind: "saved" }).catch(
        () => {}
      );
    }
  }

  /* ---------------- questions (stage 3) ---------------- */

  /**
   * Every job's questions, asked once.
   *
   * The CV parse is awaited rather than required: it was started when the CV
   * was chosen, so by now it has almost always finished, and when it has not
   * the user waits here instead of being blocked from clicking at all.
   */
  async function continueToQuestions() {
    const drafts = readyJobs(state);
    if (drafts.length === 0 || busy) return;
    setBusy(true);
    setError("");
    trackButtonClick({
      button_name: "try_now_continue",
      action: "continue",
      button_text: "Continue",
      click_source: "landing_try_now",
    });
    try {
      // Any draft the user never blurred still needs its name looked up.
      await Promise.all(drafts.filter((d) => !d.lookedUpFor).map(lookUpJobMeta));

      const { profile, rawText } = await parseCv(
        file ? { kind: "file", file } : { kind: "saved" }
      );

      const res = await fetch("/api/try/questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          rawText,
          jdTexts: drafts.map((d) => d.jdText.trim()),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Could not build the questions");

      const fullMcq = { questions: data.mcq?.questions ?? [] };
      const fullOpen: Questionnaire | null = data.questionnaire ?? null;
      /**
       * Progressive profiling: cross-reference this job's questions against
       * everything the user has already answered — on this device (the
       * localStorage cache) and, when signed in, on their account. Matches
       * are answered up front and never asked again, so an active user gets
       * a short questionnaire instead of the same one every time.
       */
      const cached = findCachedAnswers(fullMcq, fullOpen, Date.now());
      const remembered = signedIn
        ? await matchServerAnswers(fullMcq, fullOpen)
        : EMPTY_MATCH;
      // The account is the stronger source: it survives devices and cleared
      // storage, and holds the answers the user curated in My Card.
      const known = mergeMatches(remembered, cached);
      /**
       * Only NOW is the pool cut to the asking budget. Matching first means
       * the five slots go to five genuinely new questions — capping first
       * would spend them on questions the matcher was about to answer.
       */
      const capped = capQuestionPools(fullMcq, fullOpen, known.knownIds);
      const mcqPool = {
        questions: ensureAiToolOptions(normalizeMcqPool(capped.mcq.questions)),
      };
      const questionnaire = capped.questionnaire;
      const hasQuestions =
        mcqPool.questions.length > 0 ||
        (questionnaire?.questions?.length ?? 0) > 0;
      // Still the chat step even when everything is already known: the chat
      // is where the recap and the generate CTA live, and the gate branches
      // below only render for specific user states. The user simply has
      // nothing left to answer there.
      const nextStep: FunnelStep = hasQuestions ? "chat" : "gate";
      // The flow itself was already reset when the CV was parsed — all this
      // adds is the question pool, the answers the matcher filled in, and the
      // greeting, which is derived from the first job.
      setState((s) => ({
        ...s,
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
        greetingInfo: data.greeting ?? null,
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
        const merged = ensureAiToolOptions(
          normalizeMcqPool([...existing, ...fresh])
        );
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

  function startOver() {
    if (!confirm("Start over? Your uploaded CV analysis and answers will be cleared.")) return;
    clearFunnel();
    setState(EMPTY_FUNNEL);
    setFile(null);
  }

  /**
   * NOTE on the Results view below: the funnel itself no longer generates.
   * Generation is a registered-user feature, so finishQuestions() hands every
   * user over to /continue → /jobs/[id] → /api/generate. What remains here
   * renders and re-exports flows that ALREADY hold results — a completed flow
   * resumed from History — which is why the print effect above is still the
   * funnel's export-preference write site.
   */

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
    // A guest lands on the register wall above rather than regenerating:
    // generation is a registered-user feature.
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
      body: JSON.stringify({ text, length, jdText: primaryJd(state) }),
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
          jdText: primaryJd(state),
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
   * Download what is on screen, immediately.
   *
   * This used to silently rebuild the interview report first whenever the CV
   * had been edited — a 15–45s LLM call the user never asked for, during which
   * the button looked unresponsive. Downloading is now instant and never
   * spends a regeneration; if the report is behind the CV, the notice under
   * the button says so and offers the rebuild as an explicit choice.
   */
  function exportBoth() {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setPrinting(true);
    trackButtonClick({
      button_name: "anon_export_bundle",
      action: "export",
      button_text: "Download my files",
      click_source: "landing_try_now",
    });
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
  const jobDrafts = state.jobs ?? [];
  /**
   * Which job card is expanded — exactly one at a time, and that is the whole
   * point of this screen. An unfinished card is always the open one (which is
   * what makes a refresh mid-typing reopen where the user left off); an
   * explicit Edit click wins over that default.
   */
  const expandedJob =
    openedJob ?? jobDrafts.find((d) => !d.committed)?.key ?? null;
  const readyDrafts = readyJobs(state);
  const hasJob = readyDrafts.length > 0;
  /** Every exported file is named after the employer — so it is required. */
  const missingCompany = readyDrafts.some((d) => !d.company.trim());
  const canContinue = hasCvReady && hasJob && !missingCompany && !busy;
  const stepIdx = STEP_ORDER.indexOf(state.step);

  /* ---------------- state-aware banner (§3) ---------------- */
  const banner = (() => {
    if (sim === "guest_with_profile" && state.profile) {
      return {
        cls: "border-green-100 bg-green-50 text-accent-deep",
        body: (
          <>
            <strong>We found ways to improve your CV!</strong> Register
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
            <strong className="text-ink">Welcome back!</strong> Your profile is
            empty — upload your CV and complete the quick questionnaire.
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

  /**
   * The flow is strictly sequential: the CV first, then one job description at
   * a time. A finished stage collapses into a one-line chip so the only thing
   * ever expanded is the thing the user is being asked for right now.
   */

  /** One finished job: what it is, plus the controls to revisit it. */
  function JobChip({ draft, index }: { draft: JobDraft; index: number }) {
    const chars = draft.jdText.trim().length;
    const needsCompany = !draft.company.trim();
    return (
      <div className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-border bg-card p-3.5">
        <div className="flex items-center gap-2.5">
          <CheckCircle size={22} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14.5px] font-bold text-ink">
              {draft.company.trim() || `Job ${index + 1}`}
              {draft.title.trim() && (
                <span className="font-normal text-ink-faint">
                  {" "}
                  · {draft.title.trim()}
                </span>
              )}
            </span>
            <span className="block text-[12.5px] text-ink-faint">
              {draft.looking
                ? "Reading the posting…"
                : `${chars.toLocaleString("en-GB")} characters pasted`}
            </span>
          </span>
          {draft.looking && <Spinner />}
          <button
            type="button"
            onClick={() => {
              patchJob(draft.key, { committed: false });
              setOpenedJob(draft.key);
            }}
            className="cursor-pointer text-[12.5px] font-semibold text-accent underline"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => removeJob(draft.key)}
            className="cursor-pointer text-[12.5px] font-semibold text-ink-faint underline hover:text-ink"
          >
            Remove
          </button>
        </div>
        {/* Every exported file is named after the employer, so a job with no
            company would produce downloads the user cannot tell apart. */}
        {needsCompany && !draft.looking && (
          <div>
            <label className="text-[12.5px] font-semibold text-ink-soft">
              Company{" "}
              <span className="font-normal text-ink-faint">
                (used to name your downloaded files)
              </span>
            </label>
            <Input
              className="mt-1 border-amber-400 bg-amber-50/40"
              placeholder="e.g. Monday.com"
              value={draft.company}
              aria-invalid
              onChange={(e) => patchJob(draft.key, { company: e.target.value })}
            />
            <p className="mt-1 text-[12.5px] font-medium text-amber-800">
              We couldn&apos;t find the company in this posting — add it so your
              files are named for the right employer.
            </p>
          </div>
        )}
      </div>
    );
  }

  /** The one open job card: paste here, blur to file it away. */
  function JobEditor({ draft, index }: { draft: JobDraft; index: number }) {
    const typed = draft.jdText.trim().length;
    return (
      <div className="flex flex-col gap-2 rounded-2xl border-[2.5px] border-accent bg-card p-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14.5px] font-bold text-ink">
            {jobDrafts.length > 1 ? `Job ${index + 1}` : "The job you want"}
          </span>
          {jobDrafts.length > 1 && (
            <button
              type="button"
              onClick={() => removeJob(draft.key)}
              className="cursor-pointer text-[12.5px] font-semibold text-ink-faint underline hover:text-ink"
            >
              Remove
            </button>
          )}
        </div>
        <Textarea
          autoFocus={jobDrafts.length > 1}
          rows={8}
          className="min-h-[190px] resize-none rounded-lg border-2 text-[15px] leading-relaxed"
          placeholder={
            "--- Copied from LinkedIn ---\nSenior Product Manager, Growth\nTel Aviv · Hybrid\nWe're looking for a PM to own our activation funnel end-to-end…"
          }
          value={draft.jdText}
          onChange={(e) => patchJob(draft.key, { jdText: e.target.value })}
          onBlur={() => commitJob(draft)}
        />
        {typed > 0 && typed < MIN_JD_CHARS ? (
          <p className="text-[12.5px] text-ink-faint">
            Paste a bit more of the job posting (min. {MIN_JD_CHARS} characters)
          </p>
        ) : (
          typed >= MIN_JD_CHARS && (
            <button
              type="button"
              onClick={() => commitJob(draft)}
              className="cursor-pointer self-start text-[13px] font-semibold text-accent underline"
            >
              Done with this job
            </button>
          )
        )}
      </div>
    );
  }

  function uploadFields(cta: "dark" | "primary") {
    const cvSettled = state.profile !== null && hasCvReady && !cvOpen;
    const showAddJob =
      expandedJob === null &&
      hasJob &&
      !missingCompany &&
      jobDrafts.length < MAX_PACK_SIZE;
    return (
      <>
        <div className="flex flex-col gap-5">
          {/* 1 — CV upload (large, highlighted, drag-and-drop) */}
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <StepNum n={1} />
              <span className="text-[15px] font-bold text-ink">
                {cvSettled
                  ? "Your CV"
                  : baseCv
                    ? "Choose your CV"
                    : "Upload your CV"}
              </span>
            </div>
            {/* Parsed and settled → one line, so the job description is the
                only thing on screen still asking for attention. */}
            {cvSettled ? (
              <div className="flex items-center gap-2.5 rounded-2xl border-[1.5px] border-border bg-card p-3.5">
                <CheckCircle size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14.5px] font-bold text-ink">
                    {file?.name ?? baseCv?.fileName ?? "Your CV"}
                  </span>
                  <span className="block text-[12.5px] text-ink-faint">
                    {state.profile?.contact.fullName
                      ? `Read — ${state.profile.contact.fullName}`
                      : "Read and ready"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setCvOpen(true)}
                  className="cursor-pointer text-[12.5px] font-semibold text-accent underline"
                >
                  Change CV
                </button>
              </div>
            ) : (
              <>
            {/* A returning user's CV is already on file — offer it instead of
                making them find the same document again. Selecting it hides
                the dropzone; "Upload a different CV" brings it back. */}
            {baseCv && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setUseSavedCv(true);
                    setFile(null);
                    setCvOpen(false);
                    openFirstJob();
                    void parseCv({ kind: "saved" }).catch(() => {});
                  }}
                  disabled={cvBusy}
                  aria-pressed={useSavedCv}
                  className={`flex items-center gap-3 rounded-2xl border-[2.5px] p-4 text-left transition-all disabled:opacity-50 ${
                    useSavedCv
                      ? "border-accent bg-selected-bg"
                      : "border-border bg-card hover:border-accent-soft"
                  }`}
                >
                  <span className="text-2xl">📄</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-bold text-ink">
                      {baseCv.fileName}
                    </span>
                    <span className="block text-[13px] text-ink-faint">
                      {baseCv.uploadedAt
                        ? `Saved ${new Date(baseCv.uploadedAt).toLocaleDateString(
                            "en-GB",
                            { day: "numeric", month: "short" }
                          )} · ready to use`
                        : "Saved to your account · ready to use"}
                    </span>
                  </span>
                  {useSavedCv && <CheckCircle size={28} />}
                </button>
                {useSavedCv && (
                  <button
                    type="button"
                    onClick={() => setUseSavedCv(false)}
                    disabled={cvBusy}
                    className="cursor-pointer self-start text-[13px] font-semibold text-accent underline disabled:opacity-50"
                  >
                    Upload a different CV
                  </button>
                )}
              </div>
            )}
            {!(baseCv && useSavedCv) && (
            <label
              onDragEnter={(e) => {
                e.preventDefault();
                if (!cvBusy) setDragOver(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (!cvBusy) setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragOver(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (!cvBusy) acceptFile(e.dataTransfer.files?.[0]);
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
                disabled={cvBusy}
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
            )}
              </>
            )}
            {cvBusy && (
              <p className="text-[13px] text-ink-faint">
                <Spinner label="Reading your CV… you can start on the job below." />
              </p>
            )}
          </div>

          {/* 2 — The jobs, one at a time. Nothing here until a CV is chosen:
              that sequencing is the whole point of this screen. */}
          {hasCvReady && (
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <StepNum n={2} />
                <span className="text-[15px] font-bold text-ink">
                  {jobDrafts.length > 1
                    ? `Your jobs (${readyDrafts.length} of ${MAX_PACK_SIZE})`
                    : "Paste the job description"}
                </span>
              </div>
              {/* "+ Add another job" only exists once a job has been filed
                  away, so a first-timer spends the entire time pasting with
                  nothing on screen saying several jobs are even possible —
                  and then clicks Continue with one. This line is what tells
                  them, so it shows exactly when the button cannot. */}
              {!showAddJob && jobDrafts.length < MAX_PACK_SIZE && (
                <p className="text-[12.5px] text-ink-faint">
                  Applying to more than one? You can add up to {MAX_PACK_SIZE}{" "}
                  jobs — and you still answer just one set of questions.
                </p>
              )}
              {jobDrafts.map((draft, i) =>
                expandedJob === draft.key ? (
                  <JobEditor key={draft.key} draft={draft} index={i} />
                ) : (
                  <JobChip key={draft.key} draft={draft} index={i} />
                )
              )}
              {showAddJob && (
                <Button variant="outline" className="w-full" onClick={addJob}>
                  + Add another job ({jobDrafts.length} of {MAX_PACK_SIZE})
                </Button>
              )}
              {jobDrafts.length >= MAX_PACK_SIZE && expandedJob === null && (
                <p className="text-[12.5px] text-ink-faint">
                  That&apos;s the maximum of {MAX_PACK_SIZE} jobs in one go.
                </p>
              )}
            </div>
          )}
        </div>
        {/* 3 — Continue to the questions */}
        {hasCvReady && (
          <div className="flex items-stretch gap-3">
            <div className="flex items-center">
              <StepNum n={3} />
            </div>
            <Button
              variant={cta === "dark" ? "dark" : "primary"}
              size="lg"
              className="flex-1 text-[16px]"
              style={{ paddingTop: 14, paddingBottom: 14 }}
              disabled={!canContinue}
              onClick={continueToQuestions}
            >
              {busy ? (
                <Spinner label="Reading your jobs… (up to a minute)" />
              ) : readyDrafts.length > 1 ? (
                `Continue with ${readyDrafts.length} jobs →`
              ) : (
                "Continue →"
              )}
            </Button>
          </div>
        )}
        {hasCvReady && hasJob && missingCompany && (
          <p className="text-center text-[13px] text-ink-faint">
            Add the company name on every job to continue.
          </p>
        )}
        {/* Only once the flow has actually left this step — before that the
            CV chip above already says everything this line would. */}
        {state.profile && (state.furthestStep ?? 0) > 0 && (
          <p className="text-center text-[13px] text-ink-faint">
            You have an analysis in progress
            {state.profile.contact.fullName
              ? ` for ${state.profile.contact.fullName}`
              : ""}
            .{" "}
            <button
              className="cursor-pointer font-semibold text-accent underline"
              onClick={() => goTo(STEP_ORDER[state.furthestStep ?? 0] ?? "chat")}
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
            sub={`${MAX_ASKED_MCQ} quick one-tap questions and ${MAX_ASKED_OPEN} in your own words — that's everything we need to build your reports.`}
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
            // The CTA now navigates (to sign-in, or to the imported job) rather
            // than generating in place, so `leaving` is what the button should
            // reflect — without it the click looked like nothing happened for
            // the beat before the route changed.
            generateBusy={leaving}
            onBack={() => goTo("upload")}
            onGreetingReply={(reply) =>
              patch({ greetingReply: reply, greetingDone: true })
            }
            onBranch={(choice) => {
              trackButtonClick({
                button_name: `chat_branch_${choice}`,
                action: "navigate",
                button_text:
                  choice === "continue"
                    ? "Answer a few more"
                    : "Generate CV and report",
                click_source: "landing_try_now",
              });
              patch({ branchChoice: choice });
              // Start fetching IMMEDIATELY on the choice rather than on the
              // "Let's Start" click that follows it: the scripted reply takes
              // ~2.4s to type out, so overlapping the two hides most of a
              // 10-40s LLM call behind animation the user is already watching.
              if (choice === "continue" && !state.roleQuestionsLoaded) {
                void loadRoleQuestions();
              }
            }}
            onBranchStart={() => {
              patch({ branchStarted: true });
              // The core questionnaire is capped, so this branch has nothing
              // left to show unless the role bank is fetched — it used to
              // simply unlock optional questions that were already in the pool.
              // Normally a no-op by now (see onBranch above); this is the
              // fallback for a resumed flow or a failed prefetch.
              if (!state.roleQuestionsLoaded) void loadRoleQuestions();
            }}
          />
        </div>
      )}

      {/* ============ 4. The register wall ==============================
          Generation is a registered-user feature: guests answer the questions,
          then register to see the results. finishQuestions() sends them here
          for the normal path; this block is what a guest reaches when their
          questionnaire came back fully pre-answered from the answer cache, so
          there were no questions to ask at all. It used to offer generation
          directly, which quietly handed guests the whole product. */}
      {state.step === "gate" && !meta.registered && !results && (
        <div className="mx-auto flex max-w-[560px] flex-col items-center gap-[18px] text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <CheckCircle />
          </span>
          <h2 className="font-display text-[32px] font-extrabold tracking-tight text-ink [text-wrap:balance]">
            Your answers are ready
          </h2>
          <p className="text-[15.5px] leading-[1.55] text-ink-soft">
            Register to generate your tailored CV — a one-page CV made for this
            job, plus an interview report with the questions you are likely to
            be asked. Your answers are saved either way.
          </p>
          <Button size="lg" onClick={() => goToSignup("gate_register")}>
            Register to see your results →
          </Button>
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
              <strong>Love your new CV?</strong> Register to save it to
              your account and unlock job-by-job tailoring.
            </p>
            <Button size="md" onClick={() => goToSignup("results_register")}>
              Register to save →
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
                  jdText={primaryJd(state)}
                />
              </div>
              {/* Primary action — deliberately alone, above the preview frame
                  (the operational controls live on the frame's toolbar) */}
              <div ref={downloadAnchorRef} className="flex items-center justify-end">
                <Button
                  data-tour="download"
                  size="md"
                  disabled={editing}
                  loading={printing || reportBusy}
                  loadingLabel={
                    printing
                      ? "Opening your print dialog…"
                      : "Rebuilding report…"
                  }
                  title={
                    editing
                      ? "Finish editing (Done) to download"
                      : undefined
                  }
                  onClick={exportBoth}
                >
                  {downloadLabel}
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
                <p className="text-[11px] text-ink-soft">
                  You edited your CV since the interview report was built.
                  Download works either way — rebuild the report first only if
                  you want it to match.
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
          </div>

          {/* ---- 2-4. Report sections. During a refresh these are replaced
               by skeletons: fading the stale sections to 25% left the same
               text on screen and read as a frozen page. ---- */}
          <div
            ref={reportSectionsRef}
            className="flex scroll-mt-20 flex-col gap-6"
            aria-busy={reportBusy}
          >
          {reportBusy && (
            <ReportSectionsSkeleton
              cards={3}
              label="Rebuilding your report…"
              hint="Re-reading your edited CV against the job description. The match analysis, simulation and change report all come back together."
            />
          )}
          {!reportBusy && (
            <>
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
            </>
          )}
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
            disabled={editing}
            loading={printing || reportBusy}
            loadingLabel={printing ? "Opening…" : "Rebuilding report…"}
            title={editing ? "Finish editing (Done) to download" : undefined}
            onClick={exportBoth}
            className="shadow-[0_12px_32px_rgba(30,43,36,0.28)]"
          >
            <>
              <span className="hidden sm:inline">{downloadLabel}</span>
              <span className="sm:hidden">Download</span>
            </>
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

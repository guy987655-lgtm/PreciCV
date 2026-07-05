"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import {
  CV_TEMPLATES,
  CvTemplate,
  GenerationResult,
  MAX_MCQ_POOL,
  McqQuestionnaire,
} from "@/lib/types";
import {
  EMPTY_FUNNEL,
  FunnelState,
  FunnelStep,
  McqAnswer,
  clearFunnel,
  isMcqAnswered,
  loadFunnel,
  normalizeMcqPool,
  profileWithAnswers,
  saveFunnel,
  stashForSignup,
} from "@/lib/funnel";
import { simMeta, useSimUser } from "@/lib/sim-user";
import { Badge, Button, Card, Spinner, Textarea } from "@/components/ui";
import { Paywall } from "@/components/paywall";
import { McqOptions } from "@/components/mcq-options";
import { CvRenderer } from "@/components/cv-renderer";

const STEP_ORDER: FunnelStep[] = ["upload", "mcq", "open", "gate"];
const STEP_LABELS: Record<FunnelStep, string> = {
  upload: "CV + Job",
  mcq: "Quick check",
  open: "Sharpen",
  gate: "Results",
};

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
  const meta = simMeta(sim);
  const [state, setState] = useState<FunnelState>(EMPTY_FUNNEL);
  const [hydrated, setHydrated] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");
  const uploadCardRef = useRef<HTMLDivElement>(null);

  // V1 public launch: no accounts/payment yet — guests generate directly,
  // rate-limited server-side (src/lib/rate-limit.ts).
  const [results, setResults] = useState<GenerationResult | null>(null);
  const [generateBusy, setGenerateBusy] = useState(false);
  const [quotaMessage, setQuotaMessage] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [template, setTemplate] = useState<CvTemplate>("classic");

  // Restore any in-progress funnel (logo click / refresh must not lose data).
  useEffect(() => {
    const saved = loadFunnel();
    if (saved?.profile) setState(saved);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (hydrated) saveFunnel(state);
  }, [state, hydrated]);

  function patch(p: Partial<FunnelState>) {
    setState((s) => ({ ...s, ...p }));
  }
  function goTo(step: FunnelStep) {
    setError("");
    patch({ step });
  }

  /* ------------- quick-check answer handling (functional updates) ---- */
  function updateMcqAnswer(qId: string, next: McqAnswer) {
    setState((s) => ({
      ...s,
      mcqAnswers: { ...s.mcqAnswers, [qId]: next },
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
  /* ------------- carousel navigation ---------------------------------- */
  function goToQuestion(i: number) {
    setState((s) => {
      const max = Math.max((s.mcq?.questions.length ?? 1) - 1, 0);
      return { ...s, mcqIndex: Math.max(0, Math.min(i, max)) };
    });
  }
  function nextQuestion() {
    setState((s) => {
      const max = Math.max((s.mcq?.questions.length ?? 1) - 1, 0);
      return { ...s, mcqIndex: Math.min(s.mcqIndex + 1, max) };
    });
  }
  function answerOpen(qId: string, text: string) {
    setState((s) => ({ ...s, answers: { ...s.answers, [qId]: text } }));
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
      patch({
        profile: data.profile,
        rawText: data.rawText ?? "",
        questionnaire: data.questionnaire,
        mcq: { questions: normalizeMcqPool(data.mcq?.questions ?? []) },
        mcqAnswers: {},
        answers: {},
        roleQuestionsLoaded: false,
        mcqIndex: 0,
        step: (data.mcq?.questions?.length ?? 0) > 0 ? "mcq" : "open",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
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
      const res = await fetch("/api/try/role-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: state.profile,
          existingTopics: (state.mcq?.questions ?? []).map(
            (q) => q.topic || q.question
          ),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to load questions");
      const incoming: McqQuestionnaire = data.mcq ?? { questions: [] };
      setState((s) => {
        const existing = s.mcq?.questions ?? [];
        const seenText = new Set(existing.map((q) => q.question.toLowerCase()));
        const fresh = incoming.questions
          .filter((q) => !seenText.has(q.question.toLowerCase()))
          .map((q, i) => ({ ...q, id: `role_${i}_${q.id || i}` }));
        // Re-group so every category stays a contiguous carousel run.
        const merged = normalizeMcqPool([...existing, ...fresh]);
        const currentId = existing[s.mcqIndex]?.id;
        const keptIndex = merged.findIndex((q) => q.id === currentId);
        return {
          ...s,
          roleQuestionsLoaded: true,
          mcq: { questions: merged },
          mcqIndex: keptIndex >= 0 ? keptIndex : 0,
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoadingMore(false);
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
      const res = await fetch("/api/try/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, jdText: state.jdText }),
      });
      const data = await readJson(res);
      if (res.status === 429) {
        setQuotaMessage(
          data.message ?? "Daily free limit reached. Please come back tomorrow."
        );
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setResults({
        cv: data.cv,
        diff: data.diff,
        simulation: data.simulation ?? { pitch: "", questions: [] },
        jobTitle: data.jobTitle,
        company: data.company,
      });
      setRemaining(data.remaining ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setGenerateBusy(false);
    }
  }

  /** Questions done (answered or skipped) → results; generation starts. */
  function finishQuestions() {
    goTo("gate");
    if (!meta.registered && !results && !generateBusy) generateNow();
  }

  /** Two deliverable files via print-to-PDF: the CV and the report. */
  function exportPdf(target: "cv" | "report") {
    trackButtonClick({
      button_name: target === "cv" ? "anon_export_pdf" : "anon_export_report",
      action: "export",
      button_text: target === "cv" ? "Download CV (PDF)" : "Download report (PDF)",
      click_source: "landing_try_now",
    });
    document.body.classList.toggle("print-report", target === "report");
    window.print();
    setTimeout(() => document.body.classList.remove("print-report"), 500);
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

  /* ---------------- derived ---------------- */
  const mcqQuestions = state.mcq?.questions ?? [];
  const requiredQs = mcqQuestions.filter((q) => q.required);
  const requiredCount = requiredQs.length;
  const requiredAnswered = requiredQs.filter((q) =>
    isMcqAnswered(state.mcqAnswers[q.id])
  ).length;
  const mcqAnswered = mcqQuestions.filter((q) =>
    isMcqAnswered(state.mcqAnswers[q.id])
  ).length;
  // Gate: every required question must be answered; the rest are optional.
  const mcqUnlocked = requiredAnswered >= requiredCount;
  const hasJob = state.jdText.trim().length >= 100;
  const stepIdx = STEP_ORDER.indexOf(state.step);

  // Segments: required questions first ("Must answer"), then topics.
  const categories = (() => {
    const requiredIdx: number[] = [];
    const map = new Map<string, number[]>();
    mcqQuestions.forEach((mq, i) => {
      if (mq.required) {
        requiredIdx.push(i);
        return;
      }
      const t = mq.topic?.trim() || "General";
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(i);
    });
    const topicCats = [...map.entries()].map(([name, indices]) => ({
      name,
      indices,
      required: false,
    }));
    return requiredIdx.length > 0
      ? [{ name: "Must answer", indices: requiredIdx, required: true }, ...topicCats]
      : topicCats;
  })();
  const qIndex = Math.min(
    state.mcqIndex ?? 0,
    Math.max(mcqQuestions.length - 1, 0)
  );
  const currentQ = mcqQuestions[qIndex];

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

  const stepPills = state.profile && (
    <div className="mb-7 flex flex-wrap items-center justify-center gap-1.5">
      {STEP_ORDER.map((s, i) => {
        const status =
          s === state.step ? "active" : i < stepIdx ? "done" : "todo";
        return (
          <span
            key={s}
            className={
              status === "active"
                ? "rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-bold text-bg"
                : status === "done"
                  ? "rounded-full px-3 py-1.5 text-[12.5px] font-bold text-accent"
                  : "rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-muted"
            }
          >
            {status === "done" ? `✓ ${STEP_LABELS[s]}` : STEP_LABELS[s]}
          </span>
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
        <div className="grid gap-3.5 sm:grid-cols-2">
          <label
            className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${
              file
                ? "border-accent-soft bg-selected-bg"
                : "border-dropzone-border bg-dropzone-bg hover:border-accent-soft"
            }`}
          >
            <input
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              disabled={busy}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <CheckCircle size={46} />
            ) : (
              <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-green-100 text-xl font-extrabold text-accent-deep">
                ↑
              </span>
            )}
            <span className="text-[15px] font-bold text-ink">
              {file ? file.name : "Upload your CV"}
            </span>
            <span className="text-[13px] text-ink-faint">
              {file ? "Click to replace" : "PDF or DOCX"}
            </span>
          </label>

          <Textarea
            rows={6}
            className="flex-1 resize-none rounded-2xl"
            placeholder={
              "Paste the job you're targeting… (required)\nWe only ask questions that matter for THIS job."
            }
            value={state.jdText}
            onChange={(e) => patch({ jdText: e.target.value })}
          />
        </div>
        {file && state.jdText.trim().length > 0 && !hasJob && (
          <p className="text-center text-[13px] text-ink-faint">
            Paste a bit more of the job posting (min. 100 characters)
          </p>
        )}
        <Button
          variant={cta === "dark" ? "dark" : "primary"}
          size="lg"
          className="w-full"
          disabled={!file || !hasJob || busy}
          onClick={analyze}
        >
          {busy ? (
            <Spinner label="Analyzing your CV… (up to a minute)" />
          ) : (
            "Analyze my CV — free"
          )}
        </Button>
        {state.profile && (
          <p className="text-center text-[13px] text-ink-faint">
            You have an analysis in progress
            {state.profile.contact.fullName
              ? ` for ${state.profile.contact.fullName}`
              : ""}
            .{" "}
            <button
              className="cursor-pointer font-semibold text-accent underline"
              onClick={() => goTo(hasJob ? "gate" : "mcq")}
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
      <section className="mx-auto grid max-w-[1280px] items-center gap-10 px-6 pb-4 pt-10 sm:px-14 lg:grid-cols-[1fr_440px] lg:gap-14 lg:pt-16">
        <div className="flex flex-col gap-[22px]">
          {bannerEl}
          <h1 className="font-display text-[42px] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink [text-wrap:balance] sm:text-[60px]">
            Your CV, rewritten for{" "}
            <span className="marker-highlight">this job</span>. Not every job.
          </h1>
          <p className="max-w-[460px] text-lg leading-[1.55] text-ink-soft">
            Drop in your CV and the job you want. We ask the right questions,
            then hand you a one-pager that speaks that employer&apos;s
            language.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3.5">
            <Button
              size="lg"
              onClick={() =>
                uploadCardRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "center",
                })
              }
            >
              Try it free →
            </Button>
            <span className="text-sm text-ink-faint">
              Free during launch — no account needed
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
          <Card className="flex flex-col gap-3.5 p-[30px]">
            <div className="text-[17px] font-bold text-ink">
              Start here — no account needed
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
      className={`mx-auto px-6 pt-4 ${wideResults ? "max-w-[1200px]" : "max-w-[720px]"}`}
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
                : "Start here — no account needed"
            }
            sub="Your CV and the job you want — we need both to ask only the questions that matter."
          />
          <Card className="flex flex-col gap-3.5 p-7">{uploadFields("primary")}</Card>
          <p className="text-center text-[13px] text-ink-faint">
            Takes about a minute · Free during launch
          </p>
        </div>
      )}

      {/* ============ 2. Quick check — MCQ carousel (3b) ============ */}
      {state.step === "mcq" && (
        <div className="flex flex-col gap-[18px]">
          <Heading
            title={
              state.profile?.contact.fullName
                ? `Nice CV, ${state.profile.contact.fullName.split(" ")[0]}. Is it up to date?`
                : "Your CV was analyzed. Is it up to date?"
            }
            sub={
              requiredCount > 0
                ? `Only ${requiredCount} question${requiredCount === 1 ? "" : "s"} ${requiredCount === 1 ? "is" : "are"} required — everything else is optional.`
                : "All questions here are optional — answer what sharpens your story."
            }
          />

          {/* Segmented category mini-navigation */}
          <div className="flex gap-2.5">
            {categories.map((c) => {
              const answeredIn = c.indices.filter((i) =>
                isMcqAnswered(state.mcqAnswers[mcqQuestions[i].id])
              ).length;
              const active = c.indices.includes(qIndex);
              return (
                <button
                  key={c.name}
                  style={{ flexGrow: c.indices.length, flexBasis: 0 }}
                  onClick={() => goToQuestion(c.indices[0])}
                  title={`${c.name} — ${answeredIn}/${c.indices.length} answered`}
                  className="min-w-0 cursor-pointer text-left"
                >
                  <div
                    className={`truncate text-[11.5px] ${
                      active
                        ? "font-bold text-accent"
                        : c.required
                          ? "font-bold text-ink"
                          : "font-semibold text-muted"
                    }`}
                  >
                    {c.required ? `★ ${c.name}` : c.name}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-[3px] bg-chip">
                    <div
                      className={`h-full rounded-[3px] transition-all ${
                        active ? "bg-accent" : "bg-accent-soft"
                      }`}
                      style={{
                        width: `${(answeredIn / c.indices.length) * 100}%`,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Question card */}
          {currentQ && (
            <Card className="p-7">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-chip px-3 py-[5px] text-[11.5px] font-bold uppercase tracking-[0.04em] text-accent">
                    {currentQ.topic || "General"}
                  </span>
                  {currentQ.required ? (
                    <span className="rounded-full bg-ink px-3 py-[5px] text-[11.5px] font-bold uppercase tracking-[0.04em] text-bg">
                      Required
                    </span>
                  ) : (
                    <span className="text-[11.5px] font-semibold text-muted">
                      Optional
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3.5 text-xl font-bold leading-[1.35] text-ink">
                {currentQ.question}
              </div>
              <div className="mt-1 text-[13px] text-ink-faint">
                {currentQ.selectType === "ranked"
                  ? "Choose one or several — click order sets priority."
                  : "Choose one."}
              </div>
              {state.mcqAnswers[currentQ.id]?.skipped && (
                <div className="mt-1 text-[13px] text-ink-faint">
                  Skipped — picking an option answers it anyway.
                </div>
              )}
              <div className="mt-[18px]">
                <McqOptions
                  question={currentQ}
                  answer={state.mcqAnswers[currentQ.id]}
                  onChange={(next) => updateMcqAnswer(currentQ.id, next)}
                />
              </div>
            </Card>
          )}

          {/* Carousel nav row — skip lives next to Next (never on required) */}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              disabled={qIndex === 0}
              onClick={() => goToQuestion(qIndex - 1)}
            >
              ← Prev
            </Button>
            <div className="flex items-center gap-3.5">
              <span className="text-[13px] text-ink-faint">
                <strong className="text-accent">{requiredAnswered}</strong> /{" "}
                {requiredCount} required
                {mcqUnlocked
                  ? ` · ${mcqAnswered}/${mcqQuestions.length} total`
                  : " answered"}
              </span>
              {currentQ && !currentQ.required && (
                <button
                  className="cursor-pointer text-sm font-semibold text-ink-faint transition-colors hover:text-ink-soft"
                  onClick={() => {
                    setMcqSkipped(currentQ.id, true);
                    setTimeout(nextQuestion, 150);
                  }}
                >
                  Skip
                </button>
              )}
              <Button
                disabled={qIndex >= mcqQuestions.length - 1}
                onClick={nextQuestion}
              >
                Next →
              </Button>
            </div>
          </div>

          {/* Question-pool top-up (up to MAX_MCQ_POOL role questions) */}
          {(loadingMore || !state.roleQuestionsLoaded) && (
            <div className="rounded-2xl border-2 border-dashed border-dropzone-border bg-dropzone-bg p-3.5 text-center">
              {loadingMore ? (
                <Spinner label="Scanning standard role requirements to grow your question pool…" />
              ) : (
                <>
                  <p className="text-[13px] text-ink-soft">
                    Grow your pool (up to {MAX_MCQ_POOL} role-specific
                    questions) — we&apos;ll scan the standard requirements
                    employers list for your role.
                  </p>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    onClick={loadRoleQuestions}
                  >
                    Generate more role questions
                  </Button>
                </>
              )}
            </div>
          )}

          {/* Step footer */}
          <div className="flex items-center justify-between">
            <BackButton to="upload" />
            <Button disabled={!mcqUnlocked} onClick={() => goTo("open")}>
              Continue →
            </Button>
          </div>
        </div>
      )}

      {/* ============ 3. Open questions (3c) ============ */}
      {state.step === "open" && state.questionnaire && (
        <div className="flex flex-col gap-[18px]">
          <Heading
            title={`${state.questionnaire.questions.length} optional questions worth three minutes`}
            sub="Real material recruiters look for. Any language — we'll polish the wording."
          />

          {/* Prominent skip — this whole step is optional */}
          <div className="-mt-2 text-center">
            <button
              className="cursor-pointer rounded-full border-[1.5px] border-border-strong px-5 py-2 text-sm font-bold text-accent transition-colors hover:bg-card"
              onClick={finishQuestions}
            >
              Skip this step — take me to my results →
            </button>
          </div>

          <Card className="flex flex-col gap-[22px] p-7">
            {state.questionnaire.questions.map((q) => (
              <div key={q.id}>
                <div className="text-[15.5px] font-bold text-ink">
                  {q.question}
                </div>
                <div className="mt-0.5 text-[13px] text-ink-faint">{q.why}</div>
                <Textarea
                  rows={2}
                  className="mt-2.5"
                  placeholder="Type your answer…"
                  value={state.answers[q.id] ?? ""}
                  onChange={(e) => answerOpen(q.id, e.target.value)}
                />
              </div>
            ))}
          </Card>

          <div className="flex items-center justify-between gap-3">
            <BackButton to={mcqQuestions.length > 0 ? "mcq" : "upload"} />
            <div className="flex items-center gap-3">
              <button
                className="cursor-pointer text-sm font-semibold text-ink-faint transition-colors hover:text-ink-soft"
                onClick={finishQuestions}
              >
                Skip for now
              </button>
              <Button onClick={finishQuestions}>
                Continue to my results →
              </Button>
            </div>
          </div>
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
            A one-page CV tailored to this job, and an interview simulation
            report with the questions you&apos;re likely to face. Free during
            launch.
          </p>
          {quotaMessage && (
            <div className="w-full rounded-2xl border-[1.5px] border-border bg-chip px-5 py-4 text-[14px] text-ink-soft">
              {quotaMessage}
            </div>
          )}
          {generateBusy ? (
            <div className="rounded-2xl border-[1.5px] border-border bg-card px-6 py-4">
              <Spinner label="Tailoring your CV and building the report… (30–90 seconds)" />
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
            <BackButton to="open" />
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
        <div className="grid gap-6 lg:grid-cols-[minmax(280px,1fr)_2fr]">
          <div className="space-y-4 print:hidden">
            <div className="text-center lg:text-left">
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
            <Card className="p-5">
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
              {results.diff.gapAnalysis.strengths.length > 0 && (
                <>
                  <h4 className="mt-4 text-xs font-bold uppercase text-accent">
                    Strengths
                  </h4>
                  <ul className="mt-1 list-disc pl-4 text-sm text-ink-soft">
                    {results.diff.gapAnalysis.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              {results.diff.gapAnalysis.gaps.length > 0 && (
                <>
                  <h4 className="mt-3 text-xs font-bold uppercase text-red-700">
                    Gaps
                  </h4>
                  <ul className="mt-1 list-disc pl-4 text-sm text-ink-soft">
                    {results.diff.gapAnalysis.gaps.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </>
              )}
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
            {(results.simulation.pitch ||
              results.simulation.questions.length > 0) && (
              <Card className="p-5">
                <h3 className="font-bold text-ink">Interview simulation</h3>
                {results.simulation.pitch && (
                  <div className="mt-3 rounded-[14px] bg-green-50 p-3 text-sm text-accent-deep">
                    <p className="text-xs font-bold uppercase">Your 30-second pitch</p>
                    <p className="mt-1 italic">“{results.simulation.pitch}”</p>
                  </div>
                )}
                <div className="mt-3 space-y-3">
                  {results.simulation.questions.map((q, i) => (
                    <div key={i} className="rounded-[14px] border border-border p-3 text-sm">
                      <p className="font-semibold text-ink">{q.question}</p>
                      {q.whyTheyAsk && (
                        <p className="mt-1 text-xs italic text-ink-faint">
                          Why they ask: {q.whyTheyAsk}
                        </p>
                      )}
                      {q.howToAnswer && (
                        <p className="mt-1.5 text-[13px] text-ink-soft">{q.howToAnswer}</p>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card className="p-5">
              <h3 className="font-bold text-ink">Change report</h3>
              <div className="mt-3 space-y-3">
                {results.diff.changes.map((c, i) => (
                  <div key={i} className="rounded-[14px] border border-border p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
                      {c.section} · {c.type}
                    </p>
                    {c.original && <p className="diff-removed mt-1">{c.original}</p>}
                    {c.updated && <p className="diff-added mt-1">{c.updated}</p>}
                    {c.reason && (
                      <p className="mt-1.5 text-xs italic text-ink-faint">{c.reason}</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 print:hidden">
              <p className="text-xs text-ink-faint">
                ✏️ Click any text to edit — changes stay in this session only.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex rounded-full border border-border bg-card p-0.5">
                  {CV_TEMPLATES.map((t) => (
                    <button
                      key={t}
                      onClick={() => setTemplate(t)}
                      className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                        template === t
                          ? "bg-ink text-bg"
                          : "text-ink-soft hover:bg-chip"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={() => exportPdf("report")}>
                  Download report (PDF)
                </Button>
                <Button size="sm" onClick={() => exportPdf("cv")}>
                  Download CV (PDF)
                </Button>
              </div>
            </div>
            <div className="overflow-auto rounded-2xl border border-border bg-chip p-4 print:border-0 print:bg-white print:p-0">
              <CvRenderer
                cv={results.cv}
                template={template}
                editable
                onChange={(next) =>
                  setResults((r) => (r ? { ...r, cv: next } : r))
                }
              />
            </div>
            <p className="mt-4 text-center text-xs text-ink-faint print:hidden">
              {remaining !== null
                ? `${remaining} free CV${remaining === 1 ? "" : "s"} left today.`
                : "Free during launch."}
            </p>
          </div>

          {/* Printable simulation report — hidden on screen, becomes the
              second deliverable file via "Download report (PDF)" */}
          <div className="report-page bg-white p-[14mm] font-sans text-[12px] leading-relaxed text-slate-900">
            <div className="border-b-2 border-slate-900 pb-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                SpeCV · Match &amp; Interview Simulation Report
              </p>
              <h1 className="mt-1 text-[22px] font-extrabold">
                {state.profile?.contact.fullName || "Candidate"}
              </h1>
              <p className="text-[12px] text-slate-600">
                Target role: {results.jobTitle || "—"}
                {results.company ? ` · ${results.company}` : ""} · Generated{" "}
                {new Date().toLocaleDateString("en-GB")}
              </p>
            </div>

            <div className="mt-4 flex items-baseline gap-3">
              <span className="text-[28px] font-extrabold">
                {results.diff.gapAnalysis.matchScore}%
              </span>
              <span className="text-[12px] font-bold uppercase tracking-wide text-slate-500">
                match score
              </span>
            </div>

            {results.diff.gapAnalysis.strengths.length > 0 && (
              <>
                <h2 className="mt-4 text-[13px] font-extrabold uppercase tracking-wide">
                  Strengths
                </h2>
                <ul className="mt-1 list-disc pl-5">
                  {results.diff.gapAnalysis.strengths.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </>
            )}
            {results.diff.gapAnalysis.gaps.length > 0 && (
              <>
                <h2 className="mt-3 text-[13px] font-extrabold uppercase tracking-wide">
                  Gaps to prepare for
                </h2>
                <ul className="mt-1 list-disc pl-5">
                  {results.diff.gapAnalysis.gaps.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </>
            )}
            {results.diff.gapAnalysis.recommendations.length > 0 && (
              <>
                <h2 className="mt-3 text-[13px] font-extrabold uppercase tracking-wide">
                  Recommendations
                </h2>
                <ul className="mt-1 list-disc pl-5">
                  {results.diff.gapAnalysis.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            )}

            {results.simulation.pitch && (
              <>
                <h2 className="mt-4 text-[13px] font-extrabold uppercase tracking-wide">
                  Your 30-second pitch
                </h2>
                <p className="mt-1 italic">“{results.simulation.pitch}”</p>
              </>
            )}
            {results.simulation.questions.length > 0 && (
              <>
                <h2 className="mt-4 text-[13px] font-extrabold uppercase tracking-wide">
                  Interview simulation — likely questions
                </h2>
                <div className="mt-1 space-y-2.5">
                  {results.simulation.questions.map((q, i) => (
                    <div key={i}>
                      <p className="font-bold">
                        {i + 1}. {q.question}
                      </p>
                      {q.whyTheyAsk && (
                        <p className="text-[11px] italic text-slate-500">
                          Why they ask: {q.whyTheyAsk}
                        </p>
                      )}
                      {q.howToAnswer && <p>{q.howToAnswer}</p>}
                    </div>
                  ))}
                </div>
              </>
            )}

            {results.diff.changes.length > 0 && (
              <>
                <h2 className="mt-4 text-[13px] font-extrabold uppercase tracking-wide">
                  What we changed in your CV, and why
                </h2>
                <div className="mt-1 space-y-2">
                  {results.diff.changes.map((c, i) => (
                    <div key={i}>
                      <p className="text-[10px] font-bold uppercase text-slate-500">
                        {c.section} · {c.type}
                      </p>
                      {c.original && (
                        <p className="text-slate-500 line-through">{c.original}</p>
                      )}
                      {c.updated && <p>{c.updated}</p>}
                      {c.reason && (
                        <p className="text-[11px] italic text-slate-500">{c.reason}</p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}

            <p className="mt-6 border-t border-slate-300 pt-2 text-[10px] text-slate-400">
              Generated by SpeCV — every claim traces back to the
              candidate&apos;s own CV and answers. Nothing was invented.
            </p>
          </div>
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
            <BackButton to="open" />
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
          <BackButton to="open" />
        </div>
      )}

      {error && (
        <p className="mt-3 text-center text-sm text-red-700">{error}</p>
      )}
    </section>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import { MAX_MCQ_POOL, McqQuestionnaire, MIN_MCQ_ANSWERS } from "@/lib/types";
import {
  EMPTY_FUNNEL,
  FunnelState,
  FunnelStep,
  McqAnswer,
  clearFunnel,
  isMcqAnswered,
  loadFunnel,
  normalizeMcqPool,
  saveFunnel,
  stashForSignup,
} from "@/lib/funnel";
import { simMeta, useSimUser } from "@/lib/sim-user";
import { Badge, Button, Card, Spinner, Textarea } from "@/components/ui";
import { Paywall } from "@/components/paywall";
import { McqOptions } from "@/components/mcq-options";
import Link from "next/link";

const STEP_ORDER: FunnelStep[] = ["upload", "mcq", "open", "job", "gate"];
const STEP_LABELS: Record<FunnelStep, string> = {
  upload: "CV + Job",
  mcq: "Quick check",
  open: "Sharpen",
  job: "Your job",
  gate: "Get results",
};

/**
 * The homepage funnel: upload a CV + (optionally) paste a target job →
 * quick multiple-choice check → open questions → the User Card → confirm
 * the job → gate. The gate depends on the user state: unregistered users
 * hit the Registration Wall; registered users with a profile hit the
 * Paywall (payment is strictly the final step). Every change persists to
 * localStorage; /continue imports the stash right after OAuth.
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
  const mcqAnswered = mcqQuestions.filter((q) =>
    isMcqAnswered(state.mcqAnswers[q.id])
  ).length;
  const mcqNeeded = Math.min(MIN_MCQ_ANSWERS, mcqQuestions.length);
  const mcqUnlocked = mcqAnswered >= mcqNeeded;
  const hasJob = state.jdText.trim().length >= 100;
  const stepIdx = STEP_ORDER.indexOf(state.step);

  // Topical categories for the segmented mini-navigation (§carousel).
  const categories = (() => {
    const map = new Map<string, number[]>();
    mcqQuestions.forEach((mq, i) => {
      const t = mq.topic?.trim() || "General";
      if (!map.has(t)) map.set(t, []);
      map.get(t)!.push(i);
    });
    return [...map.entries()].map(([name, indices]) => ({ name, indices }));
  })();
  const qIndex = Math.min(
    state.mcqIndex ?? 0,
    Math.max(mcqQuestions.length - 1, 0)
  );
  const currentQ = mcqQuestions[qIndex];

  // The pool should reach the answer threshold — top it up automatically.
  useEffect(() => {
    if (
      hydrated &&
      state.step === "mcq" &&
      state.profile &&
      !state.roleQuestionsLoaded &&
      !loadingMore &&
      mcqQuestions.length < MIN_MCQ_ANSWERS
    ) {
      loadRoleQuestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, state.step, state.roleQuestionsLoaded]);

  /* ---------------- state-aware banner (§3) ---------------- */
  const banner = (() => {
    if (sim === "guest_with_profile" && state.profile) {
      return {
        cls: "border-indigo-200 bg-indigo-50/70 text-indigo-900",
        body: (
          <>
            🎯 <strong>We found ways to improve your CV!</strong> Register free
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
        cls: "border-amber-200 bg-amber-50/70 text-amber-900",
        body: (
          <>
            👋 <strong>Welcome back!</strong> Your dashboard is empty — upload
            your CV and complete the quick questionnaire. Job matching and
            interview simulations unlock once your base profile exists.
          </>
        ),
        action: null,
      };
    }
    if (sim === "registered_with_profile" && state.profile && !hasJob) {
      return {
        cls: "border-indigo-200 bg-indigo-50/70 text-indigo-900",
        body: (
          <>
            🗂️ <strong>Your profile is ready.</strong> Paste a job description
            to see your match — it unlocks the Job Match and Full Prep tiers.
          </>
        ),
        action: (
          <Button size="sm" onClick={() => goTo("job")}>
            Add a job →
          </Button>
        ),
      };
    }
    if (sim === "paid_with_profile") {
      return {
        cls: "border-emerald-200 bg-emerald-50/70 text-emerald-900",
        body: (
          <>
            💳 <strong>Full access active.</strong> Upload new jobs to generate
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
  const progress = state.profile && (
    <div className="mb-5 flex items-center gap-1 text-[11px] text-slate-400">
      {STEP_ORDER.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          {i > 0 && <span className="text-slate-300">›</span>}
          <span
            className={
              s === state.step
                ? "font-semibold text-indigo-600"
                : i < stepIdx
                  ? "text-slate-500"
                  : ""
            }
          >
            {STEP_LABELS[s]}
          </span>
        </span>
      ))}
    </div>
  );

  function BackButton({ to }: { to: FunnelStep }) {
    return (
      <Button variant="ghost" size="sm" onClick={() => goTo(to)}>
        ← Back
      </Button>
    );
  }

  if (leaving) {
    return (
      <Card className="mx-auto w-full max-w-3xl border-2 border-indigo-200 p-6 shadow-lg sm:p-8">
        <div className="py-8 text-center">
          <Spinner label="Taking you to sign-in… your progress is saved." />
        </div>
      </Card>
    );
  }

  return (
    <Card className="mx-auto w-full max-w-3xl border-2 border-indigo-200 p-6 shadow-lg sm:p-8">
      {banner && (
        <div
          className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${banner.cls}`}
        >
          <p>{banner.body}</p>
          {banner.action}
        </div>
      )}

      {progress}

      {/* ============ 1. Upload CV + paste job (§4.2) ============ */}
      {state.step === "upload" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            {meta.registered
              ? "Build your base profile"
              : "Start here — no account needed"}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload your CV and paste the job you&apos;re targeting. We&apos;ll
            analyze both for free and ask exactly the questions that bridge
            the gap between them.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label
              className={`flex min-h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
                file
                  ? "border-emerald-400 bg-emerald-50/50"
                  : "border-indigo-300 bg-indigo-50/40 hover:border-indigo-500 hover:bg-indigo-50"
              }`}
            >
              <input
                type="file"
                accept=".pdf,.docx"
                className="hidden"
                disabled={busy}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span className="text-3xl">{file ? "✅" : "📄"}</span>
              <span className="mt-2 text-sm font-semibold text-slate-800">
                {file ? file.name : "Upload your CV"}
              </span>
              <span className="mt-1 text-xs text-slate-500">
                {file ? "Click to replace" : "PDF or DOCX from your computer"}
              </span>
            </label>

            <div className="flex flex-col">
              <Textarea
                rows={6}
                className="flex-1 resize-none"
                placeholder={
                  "Paste the job description you're targeting…\n(optional but recommended — your questions get laser-focused on this job)"
                }
                value={state.jdText}
                onChange={(e) => patch({ jdText: e.target.value })}
              />
            </div>
          </div>

          <Button
            size="lg"
            className="mt-5 w-full"
            disabled={!file || busy}
            onClick={analyze}
          >
            {busy ? (
              <Spinner label="Analyzing your CV… (up to a minute)" />
            ) : (
              "Analyze my CV — free"
            )}
          </Button>

          {state.profile && (
            <p className="mt-3 text-center text-xs text-slate-500">
              You have an analysis in progress
              {state.profile.contact.fullName
                ? ` for ${state.profile.contact.fullName}`
                : ""}
              .{" "}
              <button
                className="cursor-pointer text-indigo-600 underline"
                onClick={() => goTo("job")}
              >
                Continue where you left off
              </button>
            </p>
          )}
        </>
      )}

      {/* ============ 2. Quick check (MCQ) ============ */}
      {state.step === "mcq" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            {state.profile?.contact.fullName
              ? `Nice CV, ${state.profile.contact.fullName.split(" ")[0]}!`
              : "Your CV was analyzed."}{" "}
            Quick check — is it up to date?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            One question at a time — answer at least {mcqNeeded} to continue.
            Use the category bar to jump around and edit earlier answers.
          </p>

          {/* Segmented mini-navigation: one segment per topical category */}
          <div className="mt-4 flex gap-1.5">
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
                  className="group min-w-0 cursor-pointer text-left"
                >
                  <span
                    className={`block truncate text-[10px] font-semibold ${
                      active
                        ? "text-indigo-700"
                        : "text-slate-400 group-hover:text-slate-600"
                    }`}
                  >
                    {c.name}
                  </span>
                  <span
                    className={`mt-0.5 block h-1.5 overflow-hidden rounded-full ${
                      active
                        ? "bg-indigo-100 ring-1 ring-indigo-400"
                        : "bg-slate-100"
                    }`}
                  >
                    <span
                      className="block h-full rounded-full bg-indigo-500 transition-all"
                      style={{
                        width: `${(answeredIn / c.indices.length) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="text-[9px] text-slate-400">
                    {answeredIn}/{c.indices.length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Carousel: one question at a time */}
          {currentQ && (
            <div className="mt-3 min-h-52 rounded-xl border border-slate-200 bg-slate-50/60 p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                  {currentQ.topic || "General"}
                </span>
                <button
                  className="shrink-0 cursor-pointer text-xs text-slate-400 hover:text-slate-600"
                  onClick={() => {
                    setMcqSkipped(currentQ.id, true);
                    setTimeout(nextQuestion, 150);
                  }}
                >
                  Skip this question
                </button>
              </div>
              <p className="mt-2 text-base font-medium text-slate-900">
                {currentQ.question}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                Choose one or several — click order sets priority.
              </p>
              {state.mcqAnswers[currentQ.id]?.skipped && (
                <p className="mt-1 text-xs text-slate-400">
                  Skipped — picking an option answers it anyway.
                </p>
              )}
              <div className="mt-3">
                <McqOptions
                  question={currentQ}
                  answer={state.mcqAnswers[currentQ.id]}
                  onChange={(next) => updateMcqAnswer(currentQ.id, next)}
                />
              </div>
            </div>
          )}

          {/* Prev / position / Next */}
          <div className="mt-3 flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={qIndex === 0}
              onClick={() => goToQuestion(qIndex - 1)}
            >
              ← Prev
            </Button>
            <span className="text-xs text-slate-500">
              Question {mcqQuestions.length === 0 ? 0 : qIndex + 1} of{" "}
              {mcqQuestions.length}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={qIndex >= mcqQuestions.length - 1}
              onClick={nextQuestion}
            >
              Next →
            </Button>
          </div>

          {/* Question-pool top-up (up to MAX_MCQ_POOL role questions) */}
          {(loadingMore || !state.roleQuestionsLoaded) && (
            <div className="mt-3 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/40 p-3 text-center">
              {loadingMore ? (
                <Spinner label="Scanning standard role requirements to grow your question pool…" />
              ) : (
                <>
                  <p className="text-xs text-slate-600">
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
                    🌐 Generate more role questions
                  </Button>
                </>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between gap-3">
            <BackButton to="upload" />
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                {mcqAnswered}/{mcqQuestions.length} answered
                {!mcqUnlocked && ` — at least ${mcqNeeded} to continue`}
              </span>
              <Button disabled={!mcqUnlocked} onClick={() => goTo("open")}>
                Continue →
              </Button>
            </div>
          </div>
          {mcqUnlocked && mcqAnswered < mcqQuestions.length && (
            <p className="mt-2 text-right text-xs text-emerald-700">
              ✓ You can continue — answering the rest sharpens your result even more.
            </p>
          )}
        </>
      )}

      {/* ============ 3. Open questions ============ */}
      {state.step === "open" && state.questionnaire && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            A few open questions to sharpen your profile
          </h2>
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
            💡 <strong>Worth 3 minutes:</strong> answering these gives the AI
            real material recruiters look for — a noticeably more precise CV
            and a significantly better shot at landing interviews. You can
            skip, but detail pays off.
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Write in whatever language feels natural — we&apos;ll polish the
            wording for you.
          </p>

          <div className="mt-4 max-h-96 space-y-4 overflow-y-auto pr-1">
            {state.questionnaire.questions.map((q) => (
              <div key={q.id}>
                <label className="text-sm font-medium text-slate-800">
                  {q.question}
                </label>
                <p className="text-xs text-slate-500">{q.why}</p>
                <Textarea
                  rows={2}
                  className="mt-1.5"
                  value={state.answers[q.id] ?? ""}
                  onChange={(e) => answerOpen(q.id, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <BackButton to={mcqQuestions.length > 0 ? "mcq" : "upload"} />
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => goTo("job")}>
                Skip for now
              </Button>
              <Button onClick={() => goTo("job")}>Continue →</Button>
            </div>
          </div>
        </>
      )}

      {/* ============ 4. Job posting ============ */}
      {state.step === "job" && (
        <>
          {/* Completion indicator: the card is ready and lives on /card */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/70 p-4">
            <p className="text-sm text-emerald-900">
              🎉 <strong>Your card is ready!</strong> Everything you told us is
              saved on{" "}
              <Link href="/card" className="font-semibold underline">
                My card
              </Link>{" "}
              — review or edit any answer there, anytime.
            </p>
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            Which job are you applying to?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste the full job posting. We&apos;ll tailor a custom CV from
            your card and show exactly what changed and why.
          </p>
          <Textarea
            rows={8}
            className="mt-4"
            placeholder="Paste the full job description here…"
            value={state.jdText}
            onChange={(e) => patch({ jdText: e.target.value })}
          />
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BackButton to="open" />
              <button
                className="cursor-pointer text-xs text-slate-400 underline hover:text-red-600"
                onClick={startOver}
              >
                Start over
              </button>
            </div>
            <div className="flex items-center gap-3">
              {state.jdText.trim().length > 0 &&
                state.jdText.trim().length < 100 && (
                  <span className="text-xs text-slate-400">
                    Paste a bit more of the posting (min. 100 characters)
                  </span>
                )}
              <Button
                variant="ghost"
                onClick={() => goTo("gate")}
              >
                Skip — base CV only
              </Button>
              <Button disabled={!hasJob} onClick={() => goTo("gate")}>
                Continue →
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ============ 6. Gate: Registration Wall / Paywall (§3, §4.3) ==== */}
      {state.step === "gate" && !meta.registered && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            One quick step before your results
          </h2>
          <Card className="mt-5 border-2 border-indigo-300 bg-indigo-50/40 p-6 text-center">
            <span className="text-3xl">🎯</span>
            <h3 className="mt-2 text-lg font-semibold text-slate-900">
              We found ways to improve your CV
              {hasJob ? " for this job" : ""}
            </h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
              Create a free account to save your progress and see the results.
              Payment only happens at the very end — right before your
              documents are generated.
            </p>
            <Button
              variant="success"
              size="lg"
              className="mt-5"
              onClick={() => goToSignup("registration_wall")}
            >
              Register free &amp; see my results
            </Button>
            <p className="mt-3 text-xs text-slate-400">
              Already have an account? The same button signs you in — your
              progress comes with you.
            </p>
          </Card>
          <div className="mt-4">
            <BackButton to="job" />
          </div>
        </>
      )}

      {state.step === "gate" && sim === "registered_no_profile" && (
        <Card className="mt-2 p-6 text-center">
          <p className="text-sm text-slate-600">
            Your base profile isn&apos;t ready yet — upload your CV and
            complete the questionnaire first.
          </p>
          <Button className="mt-4" onClick={() => goTo("upload")}>
            Build my profile
          </Button>
        </Card>
      )}

      {state.step === "gate" && sim === "registered_with_profile" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-xl font-bold text-slate-900">
              Choose what to generate
            </h2>
            <Badge tone="amber">🧪 Simulator: Registered + Profile</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-600">
            Your profile{hasJob ? " and job are" : " is"} ready. Pick a tier —
            your documents are generated right after payment.
          </p>
          <div className="mt-5">
            <Paywall
              hasJob={hasJob}
              onSelect={() => router.push("/demo")}
              onAddJob={() => goTo("job")}
            />
          </div>
          <div className="mt-4">
            <BackButton to="job" />
          </div>
        </>
      )}

      {state.step === "gate" && sim === "paid_with_profile" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            You have full access
          </h2>
          <Card className="mt-5 border-2 border-emerald-300 bg-emerald-50/40 p-6 text-center">
            <Badge tone="green">💳 Paid</Badge>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              Your payment is active for this job — head to the workspace to
              review, edit, approve and download your documents.
            </p>
            <Button
              size="lg"
              className="mt-4"
              onClick={() => router.push("/demo")}
            >
              Open the workspace (demo) →
            </Button>
          </Card>
          <div className="mt-4">
            <BackButton to="job" />
          </div>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

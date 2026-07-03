"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import { MIN_MCQ_ANSWERS, TIERS } from "@/lib/types";
import {
  EMPTY_FUNNEL,
  FunnelState,
  FunnelStep,
  clearFunnel,
  loadFunnel,
  saveFunnel,
  stashForSignup,
} from "@/lib/funnel";
import { Badge, Button, Card, Spinner, Textarea } from "@/components/ui";
import { UserCard } from "@/components/user-card";

const STEP_ORDER: FunnelStep[] = ["upload", "mcq", "open", "card", "job", "gate"];
const STEP_LABELS: Record<FunnelStep, string> = {
  upload: "Upload CV",
  mcq: "Quick check",
  open: "Sharpen",
  card: "Your card",
  job: "Add a job",
  gate: "Get reports",
};

/**
 * The anonymous funnel: upload a CV → quick multiple-choice check (verifies
 * the CV is current) → open questions → the User Card → add a job posting →
 * choose free sample / full report (sign-up gate). Every change is persisted
 * to localStorage, so navigating away never loses progress; /continue
 * imports the stash right after OAuth.
 */
export function TryNow() {
  const router = useRouter();
  const [state, setState] = useState<FunnelState>(EMPTY_FUNNEL);
  const [hydrated, setHydrated] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
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
  // Functional updates so rapid consecutive answers never overwrite each other.
  function answerMcq(qId: string, opt: string) {
    setState((s) => ({
      ...s,
      mcqAnswers: {
        ...s.mcqAnswers,
        [qId]: s.mcqAnswers[qId] === opt ? "" : opt,
      },
    }));
  }
  function answerOpen(qId: string, text: string) {
    setState((s) => ({ ...s, answers: { ...s.answers, [qId]: text } }));
  }
  function goTo(step: FunnelStep) {
    setError("");
    patch({ step });
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
      const res = await fetch("/api/try/parse-cv", { method: "POST", body: form });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      patch({
        profile: data.profile,
        rawText: data.rawText ?? "",
        questionnaire: data.questionnaire,
        mcq: data.mcq ?? { questions: [] },
        mcqAnswers: {},
        answers: {},
        step: (data.mcq?.questions?.length ?? 0) > 0 ? "mcq" : "open",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
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
  const mcqAnswered = mcqQuestions.filter((q) => state.mcqAnswers[q.id]).length;
  const mcqNeeded = Math.min(MIN_MCQ_ANSWERS, mcqQuestions.length);
  const mcqUnlocked = mcqAnswered >= mcqNeeded;
  const stepIdx = STEP_ORDER.indexOf(state.step);

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
      {progress}

      {/* ============ 1. Upload ============ */}
      {state.step === "upload" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            Try it now — no account needed
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload your CV and we&apos;ll analyze it for free. A couple of quick
            questions later you&apos;ll have your own User Card — the profile we
            use to tailor a one-page CV for any job.
          </p>

          <label
            className={`mt-6 flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
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
                onClick={() => goTo("card")}
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
            One tap per question. These are tailored to your role and make sure
            we work with your <strong>current</strong> reality, not an old CV.
          </p>

          <div className="mt-5 max-h-96 space-y-5 overflow-y-auto pr-1">
            {mcqQuestions.map((q) => (
              <div key={q.id}>
                <p className="text-sm font-medium text-slate-800">
                  {q.topic && (
                    <span className="mr-2 inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                      {q.topic}
                    </span>
                  )}
                  {q.question}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.options.map((opt) => {
                    const selected = state.mcqAnswers[q.id] === opt;
                    return (
                      <button
                        key={opt}
                        onClick={() => answerMcq(q.id, opt)}
                        className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? "border-indigo-600 bg-indigo-600 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:border-indigo-400 hover:bg-indigo-50"
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3">
            <BackButton to="upload" />
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-500">
                {mcqAnswered}/{mcqQuestions.length} answered
                {!mcqUnlocked && ` — answer at least ${mcqNeeded} to continue`}
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
              <Button variant="ghost" onClick={() => goTo("card")}>
                Skip for now
              </Button>
              <Button onClick={() => goTo("card")}>Build my card →</Button>
            </div>
          </div>
        </>
      )}

      {/* ============ 4. User Card ============ */}
      {state.step === "card" && state.profile && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            Your User Card is ready
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            This is your dossier — your latest CV plus everything you told us.
            It lives in your browser until you save it to a free account.
          </p>

          <div className="mt-4">
            <UserCard state={state} />
          </div>

          <div className="mt-4 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 sm:grid-cols-3">
            <p><strong>Guest:</strong> card lives in this browser only.</p>
            <p><strong>Free account:</strong> card saved + free tips.</p>
            <p><strong>Paid:</strong> card powers tailored CVs &amp; reports.</p>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BackButton to="open" />
              <button
                className="cursor-pointer text-xs text-slate-400 underline hover:text-red-600"
                onClick={startOver}
              >
                Start over
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => goToSignup("save_user_card")}
              >
                Save my card — free
              </Button>
              <Button onClick={() => goTo("job")}>Add a job posting →</Button>
            </div>
          </div>
        </>
      )}

      {/* ============ 5. Job posting ============ */}
      {state.step === "job" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            Which job are you applying to?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Paste the full job posting. We&apos;ll tailor a one-page CV from
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
            <BackButton to="card" />
            <div className="flex items-center gap-3">
              {state.jdText.trim().length > 0 &&
                state.jdText.trim().length < 100 && (
                  <span className="text-xs text-slate-400">
                    Paste a bit more of the posting (min. 100 characters)
                  </span>
                )}
              <Button
                disabled={state.jdText.trim().length < 100}
                onClick={() => goTo("gate")}
              >
                Continue →
              </Button>
            </div>
          </div>
        </>
      )}

      {/* ============ 6. Gate: sample vs full ============ */}
      {state.step === "gate" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            How would you like to see your tailored CV?
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Either way, a quick sign-in first keeps your card and results safe.
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Card className="flex flex-col border-2 border-emerald-300 bg-emerald-50/30 p-5">
              <Badge tone="green">Free</Badge>
              <h3 className="mt-2 font-semibold text-slate-900">
                One-time free sample
              </h3>
              <p className="mt-1 flex-1 text-sm text-slate-600">
                Create a free account and preview a real tailored CV for this
                job — limited comparison, watermarked, view-only.
              </p>
              <Button
                variant="success"
                className="mt-4 w-full"
                onClick={() => goToSignup("gate_free_sample")}
              >
                Sign up &amp; see my free sample
              </Button>
            </Card>

            <Card className="flex flex-col border-2 border-indigo-500 p-5">
              <Badge tone="indigo">
                ${TIERS.standard.priceUsd}–${TIERS.premium.priceUsd} per job
              </Badge>
              <h3 className="mt-2 font-semibold text-slate-900">
                Full tailored CV &amp; report
              </h3>
              <p className="mt-1 flex-1 text-sm text-slate-600">
                The complete one-page CV, full change report, inline editing
                and PDF download. Payment happens after sign-in.
              </p>
              <Button
                className="mt-4 w-full"
                onClick={() => goToSignup("gate_full_report")}
              >
                Sign in &amp; get the full report
              </Button>
            </Card>
          </div>

          <div className="mt-4">
            <BackButton to="job" />
          </div>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

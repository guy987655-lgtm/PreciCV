"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackButtonClick } from "@/lib/analytics";
import { MasterProfile, Questionnaire } from "@/lib/types";
import { Button, Card, Spinner, Textarea } from "@/components/ui";

export const PENDING_KEY = "precicv_pending";

type Stash = {
  profile: MasterProfile;
  rawText: string;
  questionnaire: Questionnaire;
  answers: Record<string, string>;
  jdText: string;
  savedAt: number;
};

/**
 * The prominent landing-page section: upload a CV + paste a JD without an
 * account, answer the dynamic questionnaire, and only when the reports are
 * about to be prepared — sign up. Everything is stashed in localStorage
 * and imported right after OAuth via /continue.
 */
export function TryNow() {
  const router = useRouter();
  const [step, setStep] = useState<"input" | "questions" | "signup">("input");
  const [file, setFile] = useState<File | null>(null);
  const [jdText, setJdText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [rawText, setRawText] = useState("");
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setProfile(data.profile);
      setRawText(data.rawText ?? "");
      setQuestionnaire(data.questionnaire);
      setStep("questions");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function goToSignup() {
    if (!profile || !questionnaire) return;
    trackButtonClick({
      button_name: "try_now_prepare_reports",
      action: "signup_gate",
      button_text: "Prepare my reports",
      click_source: "landing_try_now",
    });
    const stash: Stash = {
      profile,
      rawText,
      questionnaire,
      answers,
      jdText,
      savedAt: Date.now(),
    };
    localStorage.setItem(PENDING_KEY, JSON.stringify(stash));
    setStep("signup");
    router.push("/login?next=/continue");
  }

  return (
    <Card className="mx-auto w-full max-w-3xl border-2 border-indigo-200 p-6 shadow-lg sm:p-8">
      {step === "input" && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            Try it now — no account needed
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Upload your CV and paste a job posting. We&apos;ll analyze both for
            free; you only sign up when your reports are ready to be prepared.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            {/* CV upload */}
            <label
              className={`flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-colors ${
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

            {/* JD paste */}
            <div className="flex flex-col">
              <Textarea
                rows={6}
                className="flex-1 resize-none"
                placeholder={
                  "Paste the job posting text here…\n(optional — you can add it after signing up)"
                }
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
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
        </>
      )}

      {step === "questions" && questionnaire && (
        <>
          <h2 className="text-xl font-bold text-slate-900">
            {profile?.contact.fullName
              ? `Nice CV, ${profile.contact.fullName.split(" ")[0]}!`
              : "Your CV was analyzed"}{" "}
            A few questions to sharpen it
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            These uncover details recruiters look for. Answer what you can —
            skipping is fine.
          </p>
          <div className="mt-5 max-h-96 space-y-4 overflow-y-auto pr-1">
            {questionnaire.questions.map((q) => (
              <div key={q.id}>
                <label className="text-sm font-medium text-slate-800">
                  {q.question}
                </label>
                <p className="text-xs text-slate-500">{q.why}</p>
                <Textarea
                  rows={2}
                  className="mt-1.5"
                  value={answers[q.id] ?? ""}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <Button size="lg" className="mt-5 w-full" onClick={goToSignup}>
            Prepare my reports →
          </Button>
          <p className="mt-2 text-center text-xs text-slate-400">
            Next step: quick sign-in, then your tailored CV & insights report.
          </p>
        </>
      )}

      {step === "signup" && (
        <div className="py-8 text-center">
          <Spinner label="Taking you to sign-in…" />
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

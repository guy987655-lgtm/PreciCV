"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import { Dealbreaker, MasterProfile, Questionnaire } from "@/lib/types";
import { Button, Card, Input, Spinner, Textarea, Badge } from "@/components/ui";

type Step = "upload" | "questionnaire" | "dealbreakers" | "done";

const DEALBREAKER_CATEGORIES: { id: Dealbreaker["category"]; label: string; hint: string }[] = [
  { id: "technology", label: "Technology", hint: "e.g. “I refuse to work with PHP or legacy COBOL systems”" },
  { id: "work_model", label: "Work model", hint: "e.g. “Remote only — no more than 1 office day per week”" },
  { id: "location", label: "Location", hint: "e.g. “Nothing outside the Tel Aviv metro area”" },
  { id: "industry", label: "Industry", hint: "e.g. “No gambling or adtech companies”" },
  { id: "seniority", label: "Seniority", hint: "e.g. “No IC roles — management positions only”" },
  { id: "other", label: "Other", hint: "Anything else that is absolutely non-negotiable" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("upload");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [profile, setProfile] = useState<MasterProfile | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const [dealbreakers, setDealbreakers] = useState<Dealbreaker[]>([]);
  const [dbCategory, setDbCategory] = useState<Dealbreaker["category"]>("technology");
  const [dbText, setDbText] = useState("");

  async function handleUpload(file: File) {
    setBusy(true);
    setError("");
    trackButtonClick({
      button_name: "upload_cv",
      action: "upload",
      button_text: "Upload CV",
      click_source: "onboarding_upload",
    });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse-cv", { method: "POST", body: form });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setProfile(data.profile);
      setQuestionnaire(data.questionnaire);
      setStep("questionnaire");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function addDealbreaker() {
    if (!dbText.trim()) return;
    setDealbreakers((prev) => [
      ...prev,
      { id: crypto.randomUUID(), category: dbCategory, description: dbText.trim() },
    ]);
    setDbText("");
  }

  async function finish() {
    setBusy(true);
    setError("");
    trackButtonClick({
      button_name: "finish_onboarding",
      action: "submit",
      button_text: "Finish setup",
      click_source: "onboarding_dealbreakers",
    });
    try {
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers:
            questionnaire?.questions.map((q) => ({
              question: q.question,
              answer: answers[q.id] ?? "",
            })) ?? [],
          dealbreakers,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setStep("done");
      setTimeout(() => router.push("/dashboard"), 1200);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <a href="/" className="text-sm font-bold text-indigo-700">
        PreciCV
      </a>
      <h1 className="mt-3 text-2xl font-bold text-slate-900">Set up your career agent</h1>
      <p className="mt-1 text-sm text-slate-500">
        Step{" "}
        {step === "upload" ? "1" : step === "questionnaire" ? "2" : step === "dealbreakers" ? "3" : "3"}{" "}
        of 3
      </p>

      {step === "upload" && (
        <Card className="mt-6 p-8">
          <h2 className="font-semibold text-slate-900">Upload your current CV</h2>
          <p className="mt-1 text-sm text-slate-600">
            PDF or DOCX. We extract your baseline profile into your private
            Master Data Lake — this is the only time you&apos;ll ever upload it.
          </p>
          <label className="mt-6 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 p-10 hover:border-indigo-400 hover:bg-indigo-50/40">
            <input
              type="file"
              accept=".pdf,.docx"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
              }}
            />
            {busy ? (
              <Spinner label="Reading your CV and building your profile… (this can take up to a minute)" />
            ) : (
              <>
                <span className="text-3xl">📄</span>
                <span className="mt-2 text-sm font-medium text-slate-700">
                  Click to choose a PDF / DOCX
                </span>
              </>
            )}
          </label>
        </Card>
      )}

      {step === "questionnaire" && questionnaire && (
        <Card className="mt-6 p-8">
          <h2 className="font-semibold text-slate-900">
            Let&apos;s fill the gaps{profile?.contact.fullName ? `, ${profile.contact.fullName.split(" ")[0]}` : ""}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Your CV was parsed. These questions uncover details that make
            tailored CVs dramatically stronger.
          </p>
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900">
            💡 <strong>Worth 3 minutes:</strong> the more you answer, the more
            precise your tailored CVs get — and the better your odds of
            landing interviews. Answer in any language; we&apos;ll polish the
            wording.
          </div>
          <div className="mt-6 space-y-5">
            {questionnaire.questions.map((q) => (
              <div key={q.id}>
                <label className="text-sm font-medium text-slate-800">{q.question}</label>
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
          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep("upload")}>
              Back
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setStep("dealbreakers")}>
                Skip for now
              </Button>
              <Button onClick={() => setStep("dealbreakers")}>Continue</Button>
            </div>
          </div>
        </Card>
      )}

      {step === "dealbreakers" && (
        <Card className="mt-6 p-8">
          <h2 className="font-semibold text-slate-900">Your absolute dealbreakers</h2>
          <p className="mt-1 text-sm text-slate-600">
            Non-negotiables. Every job description will be scanned against
            these <strong>before</strong> you spend a credit.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {DEALBREAKER_CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setDbCategory(c.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
                  dbCategory === c.id
                    ? "bg-indigo-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {DEALBREAKER_CATEGORIES.find((c) => c.id === dbCategory)?.hint}
          </p>
          <div className="mt-2 flex gap-2">
            <Input
              value={dbText}
              placeholder="Describe the dealbreaker…"
              onChange={(e) => setDbText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addDealbreaker()}
            />
            <Button variant="secondary" onClick={addDealbreaker}>
              Add
            </Button>
          </div>

          {dealbreakers.length > 0 && (
            <ul className="mt-4 space-y-2">
              {dealbreakers.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <span>
                    <Badge tone="red">{d.category.replace("_", " ")}</Badge>{" "}
                    <span className="ml-1 text-slate-700">{d.description}</span>
                  </span>
                  <button
                    className="text-slate-400 hover:text-red-600 cursor-pointer"
                    onClick={() =>
                      setDealbreakers((prev) => prev.filter((x) => x.id !== d.id))
                    }
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-6 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep("questionnaire")}>
              Back
            </Button>
            <Button onClick={finish} disabled={busy}>
              {busy ? <Spinner /> : "Finish setup"}
            </Button>
          </div>
        </Card>
      )}

      {step === "done" && (
        <Card className="mt-6 p-8 text-center">
          <span className="text-4xl">🎉</span>
          <h2 className="mt-2 font-semibold text-slate-900">
            Your Master Data Lake is ready
          </h2>
          <p className="mt-1 text-sm text-slate-600">Taking you to your dashboard…</p>
        </Card>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </main>
  );
}

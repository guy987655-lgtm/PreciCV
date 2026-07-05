"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import { Dealbreaker, MasterProfile, Questionnaire } from "@/lib/types";
import { Button, Card, Input, Spinner, Textarea, Badge } from "@/components/ui";

type Step = "upload" | "questionnaire" | "dealbreakers" | "done";

const STEP_PILLS: { id: Step; label: string }[] = [
  { id: "upload", label: "Upload" },
  { id: "questionnaire", label: "Questions" },
  { id: "dealbreakers", label: "Dealbreakers" },
];

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

  const stepIdx = STEP_PILLS.findIndex((p) => p.id === step);

  return (
    <main className="mx-auto max-w-[720px] px-4 py-8">
      <div className="flex justify-center">
        <a
          href="/"
          className="font-display text-[21px] font-extrabold tracking-tight text-ink"
        >
          Spe<span className="text-accent">CV</span>
        </a>
      </div>

      {/* Step pills */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-1.5">
        {STEP_PILLS.map((p, i) => {
          const status =
            step === "done"
              ? "done"
              : p.id === step
                ? "active"
                : i < stepIdx
                  ? "done"
                  : "todo";
          return (
            <span
              key={p.id}
              className={
                status === "active"
                  ? "rounded-full bg-ink px-4 py-1.5 text-[12.5px] font-bold text-bg"
                  : status === "done"
                    ? "rounded-full px-3 py-1.5 text-[12.5px] font-bold text-accent"
                    : "rounded-full px-3 py-1.5 text-[12.5px] font-semibold text-muted"
              }
            >
              {status === "done" ? `✓ ${p.label}` : p.label}
            </span>
          );
        })}
      </div>

      <div className="mt-6 text-center">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight text-ink">
          Set up your career agent
        </h1>
      </div>

      {step === "upload" && (
        <Card className="mt-5 p-7">
          <h2 className="text-[17px] font-bold text-ink">Upload your current CV</h2>
          <p className="mt-1 text-[14.5px] text-ink-soft">
            PDF or DOCX. We extract your baseline profile into your private
            Master Data Lake — this is the only time you&apos;ll ever upload it.
          </p>
          <label className="mt-6 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-dropzone-border bg-dropzone-bg p-10 text-center transition-colors hover:border-accent-soft">
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
                <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-green-100 text-xl font-extrabold text-accent-deep">
                  ↑
                </span>
                <span className="text-[15px] font-bold text-ink">
                  Click to choose a PDF / DOCX
                </span>
              </>
            )}
          </label>
        </Card>
      )}

      {step === "questionnaire" && questionnaire && (
        <Card className="mt-5 p-7">
          <h2 className="text-[17px] font-bold text-ink">
            Let&apos;s fill the gaps
            {profile?.contact.fullName ? `, ${profile.contact.fullName.split(" ")[0]}` : ""}
          </h2>
          <p className="mt-1 text-[14.5px] text-ink-soft">
            Real material recruiters look for — the more you answer, the more
            precise your tailored CVs get. Any language; we&apos;ll polish the
            wording.
          </p>
          <div className="mt-6 flex flex-col gap-[22px]">
            {questionnaire.questions.map((q) => (
              <div key={q.id}>
                <div className="text-[15.5px] font-bold text-ink">{q.question}</div>
                <div className="mt-0.5 text-[13px] text-ink-faint">{q.why}</div>
                <Textarea
                  rows={2}
                  className="mt-2.5"
                  placeholder="Type your answer…"
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
              ← Back
            </Button>
            <div className="flex items-center gap-3">
              <button
                className="cursor-pointer text-sm font-semibold text-ink-faint transition-colors hover:text-ink-soft"
                onClick={() => setStep("dealbreakers")}
              >
                Skip for now
              </button>
              <Button onClick={() => setStep("dealbreakers")}>Continue →</Button>
            </div>
          </div>
        </Card>
      )}

      {step === "dealbreakers" && (
        <Card className="mt-5 p-7">
          <h2 className="text-[17px] font-bold text-ink">Your absolute dealbreakers</h2>
          <p className="mt-1 text-[14.5px] text-ink-soft">
            Non-negotiables. Every job description will be scanned against
            these <strong>before</strong> you spend a credit.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {DEALBREAKER_CATEGORIES.map((c) => (
              <button
                key={c.id}
                onClick={() => setDbCategory(c.id)}
                className={`cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  dbCategory === c.id
                    ? "bg-accent text-white"
                    : "bg-chip text-ink-soft hover:bg-[#dfe4d5]"
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[13px] text-ink-faint">
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
                  className="flex items-center justify-between rounded-[14px] bg-dropzone-bg px-3.5 py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <Badge tone="red">{d.category.replace("_", " ")}</Badge>
                    <span className="text-ink-soft">{d.description}</span>
                  </span>
                  <button
                    className="cursor-pointer text-muted transition-colors hover:text-red-700"
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
              ← Back
            </Button>
            <Button onClick={finish} disabled={busy}>
              {busy ? <Spinner /> : "Finish setup"}
            </Button>
          </div>
        </Card>
      )}

      {step === "done" && (
        <Card className="mt-5 p-8 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-accent text-sm font-extrabold text-white">
              ✓
            </span>
          </span>
          <h2 className="mt-3 font-display text-xl font-extrabold text-ink">
            Your Master Data Lake is ready
          </h2>
          <p className="mt-1 text-[14.5px] text-ink-soft">
            Taking you to your dashboard…
          </p>
        </Card>
      )}

      {error && <p className="mt-4 text-center text-sm text-red-700">{error}</p>}
    </main>
  );
}

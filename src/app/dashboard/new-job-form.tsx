"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import { Button, Card, Input, Spinner, Textarea } from "@/components/ui";

export function NewJobForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"paste" | "url">("paste");
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [fallbackReason, setFallbackReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function fetchUrl() {
    setBusy(true);
    setError("");
    setFallbackReason("");
    trackButtonClick({
      button_name: "fetch_jd_url",
      action: "fetch",
      button_text: "Fetch job posting",
      click_source: "dashboard_new_job",
    });
    try {
      const res = await fetch("/api/jd/fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: jdUrl }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch URL");
      if (data.fallback) {
        // Anti-scraping fallback (PRD §4.3): prompt manual paste.
        setFallbackReason(data.reason);
        setMode("paste");
      } else {
        setJdText(data.text);
        setMode("paste");
        setFallbackReason("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function createJob() {
    setBusy(true);
    setError("");
    trackButtonClick({
      button_name: "create_job",
      action: "submit",
      button_text: "Check job & continue",
      click_source: "dashboard_new_job",
    });
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jdText, jdUrl: mode === "url" ? jdUrl : jdUrl || "" }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Failed to create job");
      router.push(`/jobs/${data.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 p-6">
      <div className="flex gap-2">
        <button
          onClick={() => setMode("paste")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium cursor-pointer ${
            mode === "paste" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          Paste text
        </button>
        <button
          onClick={() => setMode("url")}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium cursor-pointer ${
            mode === "url" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
          }`}
        >
          From URL
        </button>
      </div>

      {fallbackReason && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {fallbackReason}
        </p>
      )}

      {mode === "url" ? (
        <div className="mt-4 flex gap-2">
          <Input
            placeholder="https://…  (job posting URL)"
            value={jdUrl}
            onChange={(e) => setJdUrl(e.target.value)}
          />
          <Button onClick={fetchUrl} disabled={busy || !jdUrl}>
            {busy ? <Spinner /> : "Fetch"}
          </Button>
        </div>
      ) : (
        <>
          <Textarea
            rows={7}
            className="mt-4"
            placeholder="Paste the full job description here…"
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
          />
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-slate-400">
              We&apos;ll scan it against your dealbreakers before anything is charged.
            </p>
            <Button onClick={createJob} disabled={busy || jdText.trim().length < 100}>
              {busy ? <Spinner label="Scanning dealbreakers…" /> : "Check job & continue"}
            </Button>
          </div>
        </>
      )}

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Card>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import {
  CvTemplate,
  CV_TEMPLATES,
  DealbreakerHit,
  DiffReport,
  TailoredCv,
  TIERS,
  TierId,
} from "@/lib/types";
import { Badge, Button, Card, Modal, Spinner, Textarea } from "@/components/ui";
import { CvRenderer } from "@/components/cv-renderer";
import { Paywall } from "@/components/paywall";

type Props = {
  job: {
    id: string;
    title: string;
    company: string;
    dealbreakerHits: DealbreakerHit[];
  };
  purchase: {
    tier: TierId;
    revisionsUsed: number;
    maxRevisions: number;
  } | null;
  generation: {
    id: string;
    cv: TailoredCv;
    diff: DiffReport;
    template: string;
    revisionNumber: number;
    isSample?: boolean;
  } | null;
  freeSampleAvailable?: boolean;
};

/**
 * Free (registered, non-paying) users get a deliberately limited comparison:
 * education / skills in full, key points from a single role, and everything
 * else hidden behind the paywall.
 */
function limitSampleCv(cv: TailoredCv): { cv: TailoredCv; hidden: string[] } {
  const sections: TailoredCv["sections"] = [];
  const hidden: string[] = [];
  let roleShown = false;
  for (const s of cv.sections) {
    const name = `${s.id} ${s.title}`.toLowerCase();
    if (/educ|skill|cert|lang/.test(name)) {
      sections.push(s);
    } else if (!roleShown && /exp|work|employ|career/.test(name)) {
      sections.push({ ...s, items: s.items.slice(0, 1) });
      roleShown = true;
      if (s.items.length > 1) hidden.push(`${s.items.length - 1} more roles`);
    } else {
      hidden.push(s.title || s.id);
    }
  }
  // Fallback: if no section matched the heuristics, show the first one only.
  if (sections.length === 0 && cv.sections.length > 0) {
    sections.push(cv.sections[0]);
    hidden.push(...cv.sections.slice(1).map((s) => s.title || s.id));
  }
  return { cv: { ...cv, sections }, hidden };
}

/** Diagonal repeated watermark for the locked free-sample preview. */
function SampleWatermark() {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      <div className="flex h-full w-full -rotate-30 flex-col justify-around opacity-[0.13]">
        {Array.from({ length: 12 }).map((_, row) => (
          <div key={row} className="flex justify-around whitespace-nowrap">
            {Array.from({ length: 4 }).map((_, col) => (
              <span key={col} className="text-3xl font-black text-indigo-900">
                PreciCV · PREVIEW
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function JobWorkspace({
  job,
  purchase,
  generation: initialGen,
  freeSampleAvailable = false,
}: Props) {
  const router = useRouter();
  const [generation, setGeneration] = useState(initialGen);
  const [sampleLeft, setSampleLeft] = useState(freeSampleAvailable);
  const [busy, setBusy] = useState<"" | "checkout" | "generate" | "revise">("");
  const [error, setError] = useState("");
  const [redFlagModal, setRedFlagModal] = useState(false);
  const [pendingSample, setPendingSample] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseText, setReviseText] = useState("");
  const [revisionsUsed, setRevisionsUsed] = useState(purchase?.revisionsUsed ?? 0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  // The user reviews + edits first; files (PDF export) unlock on approval.
  const [approved, setApproved] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hits = job.dealbreakerHits;
  const isSample = Boolean(generation?.isSample);
  const sampleView = generation && isSample ? limitSampleCv(generation.cv) : null;
  const visibleChanges = generation
    ? isSample
      ? generation.diff.changes.slice(0, 3)
      : generation.diff.changes
    : [];
  const hiddenChangeCount = generation
    ? generation.diff.changes.length - visibleChanges.length
    : 0;

  /* ---------------- payment ---------------- */
  async function checkout(tier: TierId) {
    setBusy("checkout");
    setError("");
    trackButtonClick({
      button_name: `buy_${tier}`,
      action: "checkout",
      button_text: `Buy ${TIERS[tier].name}`,
      click_source: "job_workspace",
      job_id: job.id,
    });
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, tier }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Checkout failed");
      window.location.href = data.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy("");
    }
  }

  /* ---------------- generation (paid credit or free sample) --------- */
  async function generate(acknowledged: boolean, asSample: boolean) {
    if (hits.length > 0 && !acknowledged) {
      setPendingSample(asSample);
      setRedFlagModal(true);
      return;
    }
    setRedFlagModal(false);
    setBusy("generate");
    setError("");
    trackButtonClick({
      button_name: asSample ? "generate_free_sample" : "generate_cv",
      action: "generate",
      button_text: asSample ? "Generate my free sample" : "Generate tailored CV",
      click_source: "job_workspace",
      job_id: job.id,
    });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          acknowledgeRedFlags: acknowledged,
          useFreeSample: asSample,
        }),
      });
      const data = await readJson(res);
      if (!res.ok) {
        if (data.error === "payment_required") {
          throw new Error("Purchase a tier below to generate.");
        }
        throw new Error(data.message ?? data.error ?? "Generation failed");
      }
      setGeneration({
        id: data.generationId,
        cv: data.cv,
        diff: data.diff,
        template: generation?.template ?? "classic",
        revisionNumber: generation?.revisionNumber ?? 0,
        isSample: data.isSample ?? false,
      });
      if (asSample) setSampleLeft(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  /* ---------------- AI revisions (premium) ---------------- */
  async function revise() {
    setBusy("revise");
    setError("");
    trackButtonClick({
      button_name: "request_revision",
      action: "revise",
      button_text: "Apply revision",
      click_source: "job_workspace",
      job_id: job.id,
    });
    try {
      const res = await fetch("/api/revise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id, instructions: reviseText }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.message ?? data.error ?? "Revision failed");
      setGeneration({
        id: data.generationId,
        cv: data.cv,
        diff: data.diff,
        template: generation?.template ?? "classic",
        revisionNumber: data.revisionNumber,
        isSample: false,
      });
      setRevisionsUsed((n) => n + 1);
      setReviseOpen(false);
      setReviseText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  /* ---------------- inline edits: debounced save, no credits ---------- */
  const saveCv = useCallback(
    (next: TailoredCv, template?: string) => {
      if (!generation || isSample) return;
      setGeneration((g) => (g ? { ...g, cv: next, template: template ?? g.template } : g));
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        await fetch(`/api/generations/${generation.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cv: next, ...(template ? { template } : {}) }),
        });
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1500);
      }, 800);
    },
    [generation, isSample]
  );

  async function setTemplate(t: CvTemplate) {
    if (!generation || isSample) return;
    setGeneration({ ...generation, template: t });
    await fetch(`/api/generations/${generation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template: t }),
    });
  }

  function exportPdf() {
    trackButtonClick({
      button_name: "export_pdf",
      action: "export",
      button_text: "Export PDF",
      click_source: "job_workspace",
      job_id: job.id,
    });
    window.print();
  }

  // The workspace always has a job attached, so all three tiers are open.
  const tierCards = (
    <Paywall hasJob busy={busy === "checkout"} onSelect={checkout} />
  );

  /* ================= render ================= */

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold text-slate-900">
            {job.title || "Tailored CV"}
            {job.company && <span className="font-normal text-slate-500"> · {job.company}</span>}
          </h1>
        </div>
        {generation && !isSample && (
          <div className="flex items-center gap-3">
            {saveState !== "idle" && (
              <span className="text-xs text-slate-400">
                {saveState === "saving" ? "Saving…" : "Saved ✓"}
              </span>
            )}
            <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
              {CV_TEMPLATES.map((t) => (
                <button
                  key={t}
                  onClick={() => setTemplate(t)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize cursor-pointer ${
                    generation.template === t
                      ? "bg-indigo-600 text-white"
                      : "text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {approved && <Button onClick={exportPdf}>Export PDF</Button>}
          </div>
        )}
        {generation && isSample && <Badge tone="amber">Free sample — preview only</Badge>}
      </header>

      {/* Approval gate: review & edit first, files unlock on approval */}
      {generation && !isSample && !approved && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50/60 p-4 print:hidden">
          <p className="text-sm text-emerald-900">
            <strong>Review your tailored CV.</strong> Edit anything inline,
            keep or remove sections — or approve it as-is. Your final files
            (CV + simulation report) are created after approval.
          </p>
          <Button
            size="lg"
            variant="success"
            onClick={() => {
              trackButtonClick({
                button_name: "approve_cv",
                action: "approve",
                button_text: "Approve CV",
                click_source: "job_workspace",
                job_id: job.id,
              });
              setApproved(true);
            }}
          >
            ✓ Approve CV &amp; create my files
          </Button>
        </div>
      )}
      {generation && !isSample && approved && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 print:hidden">
          <p className="text-sm text-emerald-900">
            <strong>Approved ✓</strong> Your final files are ready — export
            the CV as a PDF; the change report alongside it is your
            simulation report.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setApproved(false)}>
              Keep editing
            </Button>
            <Button onClick={exportPdf}>Export PDF</Button>
          </div>
        </div>
      )}

      {/* Red-flag banner */}
      {hits.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 print:hidden">
          <p className="font-semibold text-red-800">⚑ Potential red flags detected</p>
          <ul className="mt-2 space-y-1 text-sm text-red-700">
            {hits.map((h, i) => (
              <li key={i}>
                <strong>{h.dealbreakerText}</strong> — JD says: “{h.evidence}”{" "}
                <Badge tone="red">{h.confidence}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* State 1: nothing generated yet */}
      {!purchase && !generation && (
        <div className="mx-auto max-w-3xl space-y-6 print:hidden">
          {sampleLeft && (
            <Card className="border-2 border-emerald-300 bg-emerald-50/40 p-6 text-center">
              <Badge tone="green">One-time free sample</Badge>
              <h2 className="mt-2 text-lg font-semibold text-slate-900">
                See it before you pay
              </h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                Generate a real tailored CV for this job, shown as a
                watermarked preview (not downloadable). You can use this
                once per account.
              </p>
              <Button
                size="lg"
                variant="success"
                className="mt-4"
                disabled={busy === "generate"}
                onClick={() => generate(false, true)}
              >
                {busy === "generate" ? (
                  <Spinner label="Preparing your sample… (30–90 seconds)" />
                ) : (
                  "Generate my free sample"
                )}
              </Button>
            </Card>
          )}
          {tierCards}
        </div>
      )}

      {/* State 2: paid, not generated */}
      {purchase && !generation && (
        <Card className="mx-auto max-w-xl p-8 text-center print:hidden">
          <Badge tone="indigo">{TIERS[purchase.tier].name} tier active</Badge>
          <h2 className="mt-3 text-lg font-semibold text-slate-900">
            Ready to tailor your CV
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Claude will build a one-page CV tailored to this job from your
            Master Data Lake, plus a full change report.
          </p>
          <Button
            size="lg"
            className="mt-6"
            disabled={busy === "generate"}
            onClick={() => generate(false, false)}
          >
            {busy === "generate" ? (
              <Spinner label="Tailoring your CV… (30–90 seconds)" />
            ) : (
              "Generate tailored CV"
            )}
          </Button>
        </Card>
      )}

      {/* Paid while a sample exists → unlock banner */}
      {purchase && generation && isSample && (
        <div className="mb-6 flex items-center justify-between rounded-xl border border-indigo-200 bg-indigo-50 p-4 print:hidden">
          <p className="text-sm text-indigo-900">
            <strong>Payment received.</strong> Unlock your CV to enable
            editing, templates and PDF export.
          </p>
          <Button disabled={busy === "generate"} onClick={() => generate(true, false)}>
            {busy === "generate" ? <Spinner /> : "Unlock full version"}
          </Button>
        </div>
      )}

      {/* State 3: the Side-by-Side Review Workspace (PRD §5) */}
      {generation && (
        <div className="grid gap-6 lg:grid-cols-[minmax(320px,2fr)_3fr]">
          {/* Left pane: Diff Report */}
          <div className="space-y-4 print:hidden">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-900">Match analysis</h2>
                <span className="text-2xl font-bold text-indigo-600">
                  {generation.diff.gapAnalysis.matchScore}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: `${generation.diff.gapAnalysis.matchScore}%` }}
                />
              </div>
              {generation.diff.gapAnalysis.strengths.length > 0 && (
                <>
                  <h3 className="mt-4 text-xs font-semibold uppercase text-emerald-700">
                    Strengths
                  </h3>
                  <ul className="mt-1 list-disc pl-4 text-sm text-slate-600">
                    {generation.diff.gapAnalysis.strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              {!isSample && generation.diff.gapAnalysis.gaps.length > 0 && (
                <>
                  <h3 className="mt-3 text-xs font-semibold uppercase text-red-700">Gaps</h3>
                  <ul className="mt-1 list-disc pl-4 text-sm text-slate-600">
                    {generation.diff.gapAnalysis.gaps.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </>
              )}
              {!isSample && generation.diff.gapAnalysis.recommendations.length > 0 && (
                <>
                  <h3 className="mt-3 text-xs font-semibold uppercase text-indigo-700">
                    Recommendations
                  </h3>
                  <ul className="mt-1 list-disc pl-4 text-sm text-slate-600">
                    {generation.diff.gapAnalysis.recommendations.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </>
              )}
              {isSample && (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  🔒 The gap analysis and concrete recommendations are part of
                  the full report.
                </p>
              )}
            </Card>

            <Card className="p-5">
              <h2 className="font-semibold text-slate-900">
                Change report{" "}
                {generation.revisionNumber > 0 && (
                  <Badge tone="indigo">rev {generation.revisionNumber}</Badge>
                )}
              </h2>
              <div className="mt-3 space-y-3">
                {visibleChanges.map((c, i) => (
                  <div key={i} className="rounded-lg border border-slate-100 p-3 text-sm">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {c.section} · {c.type}
                    </p>
                    {c.original && (
                      <p className="mt-1">
                        <span className="diff-removed">{c.original}</span>
                      </p>
                    )}
                    {c.updated && (
                      <p className="mt-1">
                        <span className="diff-added">{c.updated}</span>
                      </p>
                    )}
                    {c.reason && (
                      <p className="mt-1.5 text-xs italic text-slate-500">{c.reason}</p>
                    )}
                  </div>
                ))}
                {hiddenChangeCount > 0 && (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    🔒 {hiddenChangeCount} more change
                    {hiddenChangeCount > 1 ? "s" : ""} in the full report —
                    unlock to see everything.
                  </p>
                )}
              </div>
            </Card>

            {/* AI revisions (Full Prep tier) */}
            {purchase && purchase.maxRevisions > 0 && !isSample && (
              <Card className="p-5">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-slate-900">AI revisions</h2>
                  <span className="text-xs text-slate-500">
                    {revisionsUsed}/{purchase.maxRevisions} used
                  </span>
                </div>
                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  disabled={revisionsUsed >= purchase.maxRevisions}
                  onClick={() => setReviseOpen(true)}
                >
                  Request a revision
                </Button>
              </Card>
            )}
          </div>

          {/* Right pane: the CV — editable when owned, watermarked when sample */}
          <div>
            {isSample ? (
              <p className="mb-2 text-xs text-amber-700 print:hidden">
                🔒 Limited watermarked preview — the free sample shows your
                education, skills and one role only. Purchase this job to see
                the complete CV, edit it and download.
              </p>
            ) : (
              <p className="mb-2 text-xs text-slate-400 print:hidden">
                Click any text on the CV to edit it directly — free, no credits used.
              </p>
            )}
            <div
              className={`overflow-auto rounded-xl border border-slate-200 bg-slate-100 p-4 ${
                isSample
                  ? "print:hidden select-none"
                  : "print:border-0 print:bg-white print:p-0"
              }`}
            >
              <div className="relative origin-top-left scale-[0.85] lg:scale-100">
                {isSample && <SampleWatermark />}
                <div className={isSample ? "pointer-events-none" : ""}>
                  <CvRenderer
                    cv={sampleView ? sampleView.cv : generation.cv}
                    template={generation.template as CvTemplate}
                    editable={!isSample}
                    onChange={(next) => saveCv(next)}
                  />
                </div>
              </div>
            </div>
            {sampleView && sampleView.hidden.length > 0 && (
              <p className="mt-2 text-xs text-amber-700 print:hidden">
                🔒 Hidden in the free sample: {sampleView.hidden.join(", ")}.
              </p>
            )}

            {/* Sample → conversion CTA */}
            {isSample && !purchase && (
              <div className="mt-6 print:hidden">
                <h2 className="mb-3 text-center text-lg font-semibold text-slate-900">
                  Like what you see? Unlock the full version
                </h2>
                {tierCards}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-4 text-center text-sm text-red-600 print:hidden">{error}</p>}

      {/* PRD §4.3 warning modal */}
      <Modal
        open={redFlagModal}
        onClose={() => setRedFlagModal(false)}
        title="⚑ We noticed a potential Red Flag"
      >
        <div className="space-y-2 text-sm text-slate-600">
          {hits.map((h, i) => (
            <p key={i}>
              This job requires <strong>“{h.evidence}”</strong>, which conflicts with your
              dealbreaker: <strong>{h.dealbreakerText}</strong>.
            </p>
          ))}
          <p className="pt-2 font-medium text-slate-800">
            {pendingSample
              ? "Are you sure you want to use your one-time free sample on it?"
              : "Are you sure you want to proceed and spend a credit?"}
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setRedFlagModal(false)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => generate(true, pendingSample)}>
            Proceed anyway
          </Button>
        </div>
      </Modal>

      {/* Premium revision modal */}
      <Modal
        open={reviseOpen}
        onClose={() => setReviseOpen(false)}
        title="Request an AI revision"
      >
        <p className="text-sm text-slate-600">
          Tell Claude what to change. Revisions are locked to this job (
          {purchase ? purchase.maxRevisions - revisionsUsed : 0} remaining).
        </p>
        <Textarea
          rows={4}
          className="mt-3"
          placeholder="e.g. Emphasize my leadership experience more, and shorten the education section…"
          value={reviseText}
          onChange={(e) => setReviseText(e.target.value)}
        />
        <div className="mt-4 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setReviseOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy === "revise" || reviseText.trim().length < 3} onClick={revise}>
            {busy === "revise" ? <Spinner label="Revising…" /> : "Apply revision"}
          </Button>
        </div>
      </Modal>
    </main>
  );
}

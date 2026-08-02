"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import { generateJobWithRetry } from "@/lib/generate-client";
import { spendCreditOnJob, useCredits } from "@/lib/use-credits";
import { startPackCheckout } from "@/lib/checkout";
import { PackQuantity, isPackQuantity } from "@/lib/packs";
import { freeMode } from "@/lib/free-mode";
import { DEFAULT_TEMPLATE, asTemplate, effectiveSplit } from "@/lib/templates";
import {
  PrintQueueItem,
  printItemLabel,
  printQueue,
} from "@/lib/download";
import type {
  DealbreakerHit,
  DiffReport,
  InterviewSimulation,
  TailoredCv,
} from "@/lib/types";
import { Badge, Button, Card, Modal } from "@/components/ui";
import { ProgressBar } from "@/components/progress-bar";
import { BundlePaywall } from "@/components/bundle-paywall";
import { CvRenderer } from "@/components/cv-renderer";
import {
  DesignPreviewModal,
  type DesignChoice,
} from "@/components/design-preview-modal";
import { ReportPage } from "@/components/report-page";
import { asCvTheme } from "@/lib/export-prefs";
import {
  preferredExportPrefs,
  rememberExportPrefs,
  saveAccountPrefs,
} from "@/lib/prefs";

export type RunJob = {
  id: string;
  title: string;
  company: string;
  dealbreakerHits: DealbreakerHit[];
  hasResult: boolean;
  isSample: boolean;
  tier: string | null;
  orderId: string | null;
};

type RunDocument = {
  jobId: string;
  generationId: string;
  title: string;
  company: string;
  template: string;
  /** The design this document prints in — see GET /api/run/[id]/documents. */
  cvTheme: string;
  splitView: boolean;
  cv: TailoredCv;
  diff: DiffReport;
  simulation: InterviewSimulation | null;
};

/** Per-row transient state that isn't derivable from the server row. */
type RowState =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "unlocking" }
  | { kind: "failed"; message: string };

/** How many generations run at once. */
const CONCURRENCY = 2;

/**
 * What a row is, in the order the UI cares about.
 *
 * `preview` is the one free sample a run gets (job #1): a real tailored CV,
 * watermarked and locked. Everything after it waits for a credit.
 */
function rowStatus(
  job: RunJob,
  state: RowState
):
  | "generating"
  | "unlocking"
  | "failed"
  | "ready"
  | "preview"
  | "queued"
  | "locked" {
  if (state.kind === "generating") return "generating";
  if (state.kind === "unlocking") return "unlocking";
  if (state.kind === "failed") return "failed";
  if (job.hasResult && !job.isSample) return "ready";
  if (job.isSample) return "preview";
  // Paid but nothing generated yet. This has to come before "locked":
  // a job whose credit was already spent is waiting on the LLM, not on the
  // user's wallet, and telling them it is locked invites them to pay twice.
  if (job.tier) return "queued";
  return "locked";
}

export function RunWorkspace({
  runId,
  initialJobs,
  candidateName,
}: {
  runId: string;
  initialJobs: RunJob[];
  candidateName: string;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState<RunJob[]>(initialJobs);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  /**
   * The design modal, and the design it opens on.
   *
   * The seed is read in the click handler rather than inside the modal: this
   * page is server-rendered and localStorage is not readable there, so reading
   * it during render would hydrate a different design than the server painted.
   * A click is unambiguously client-side.
   */
  const [designSeed, setDesignSeed] = useState<Partial<DesignChoice> | null>(
    null
  );
  const [designBusy, setDesignBusy] = useState(false);
  const designOpen = designSeed !== null;

  function openDesign() {
    setDesignSeed(preferredExportPrefs());
  }
  const { balance: credits, setBalance: setCredits, refresh: refreshCredits } =
    useCredits(true);

  /* ---------------- download queue ---------------- */
  const [downloading, setDownloading] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [queueTotal, setQueueTotal] = useState(0);
  const [queueLabel, setQueueLabel] = useState("");
  const [docs, setDocs] = useState<Record<string, RunDocument>>({});
  /** The single document currently mounted as a print target. */
  const [printMount, setPrintMount] = useState<PrintQueueItem | null>(null);
  const mountResolve = useRef<(() => void) | null>(null);

  const ready = jobs.filter((j) => j.hasResult && !j.isSample);
  const previews = jobs.filter((j) => j.isSample);
  /**
   * Jobs with no purchase yet — the ONLY ones a credit or a checkout is for.
   *
   * This used to be "no result yet", which quietly counted paid jobs that were
   * still generating: mid-run the page offered to sell unlocks for three jobs
   * the user had already paid for. Paid-ness, not generated-ness, is what
   * decides whether money is still owed.
   */
  const unpaid = jobs.filter((j) => !j.tier);
  const generated = jobs.filter((j) => j.hasResult).length;
  const redFlagJobs = jobs.filter((j) => j.dealbreakerHits.length > 0);
  const [redFlagsAck, setRedFlagsAck] = useState(false);
  /**
   * What to do once the dealbreaker warning is acknowledged. Both entry points
   * spend something the user cannot get back — a free preview or a credit — so
   * both wait behind the same modal rather than only the bulk one.
   */
  const [pendingAction, setPendingAction] = useState<
    | { kind: "all" }
    | { kind: "unlockSelected" }
    | { kind: "unlock"; jobId: string }
    | null
  >(null);

  // Two files per ready job — the CV and the interview report. Every purchase
  // owns both, so there is no per-job tier to add up.
  const fileCount = ready.length * 2;

  /* ---------------- credit allocation ---------------- */

  /**
   * Which locked jobs the user wants their credits spent on.
   *
   * A run can hold more jobs than the user bought credits for — five jobs, four
   * credits — and which four get built is their call, not a first-N accident.
   *
   * Seeded from the balance rather than left empty so the common case (enough
   * credits for everything) needs no clicks at all, and re-seeded whenever the
   * balance changes so returning from checkout lands on a sensible default.
   */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const lockedIds = unpaid.filter((j) => !j.tier).map((j) => j.id);
  /**
   * Derived rather than seeded by an effect, so the default follows the
   * balance for free: buying credits is a full navigation (Lemon Squeezy and
   * back), and this page re-renders with the new total already applied.
   *
   * A user's own ticks are re-filtered against both the locked set and the
   * balance every render — an id that has since been paid for, or a pick that
   * no longer fits the credits on hand, silently drops out instead of sending
   * a spend that the atomic RPC would only reject.
   */
  const selected =
    picked === null
      ? new Set(lockedIds.slice(0, credits.total))
      : new Set(lockedIds.filter((id) => picked.has(id)).slice(0, credits.total));

  const selectedJobs = unpaid.filter((j) => selected.has(j.id));
  /** At the ceiling — further boxes are disabled rather than silently ignored. */
  const allocationFull = selected.size >= credits.total;

  function toggleSelected(jobId: string) {
    const next = new Set(selected);
    if (next.has(jobId)) next.delete(jobId);
    else if (next.size < credits.total) next.add(jobId);
    setPicked(next);
  }

  function setRow(jobId: string, state: RowState) {
    setRows((prev) => ({ ...prev, [jobId]: state }));
  }

  function patchJob(jobId: string, next: Partial<RunJob>) {
    setJobs((js) => js.map((j) => (j.id === jobId ? { ...j, ...next } : j)));
  }

  /* ---------------- generation ---------------- */

  /**
   * Generate one job.
   *
   * `useFreeSample` is true only for the first job in a run — that is the
   * one-preview-per-run rule. Generating a free sample for all five would
   * burn the whole daily allowance (5/day, see src/lib/free-quota.ts) and five
   * LLM calls before anyone had paid anything.
   */
  async function runOne(job: RunJob, asSample: boolean) {
    setRow(job.id, { kind: "generating" });
    try {
      const data = await generateJobWithRetry(job.id, {
        useFreeSample: asSample,
        acknowledgeRedFlags: true,
      });
      if (data.quota) {
        setRow(job.id, { kind: "failed", message: data.quota as string });
        return;
      }
      patchJob(job.id, {
        hasResult: true,
        isSample: Boolean(data.isSample),
        company: (data.company as string) || job.company,
        title: (data.jobTitle as string) || job.title,
      });
      setRow(job.id, { kind: "idle" });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed";
      setRow(job.id, {
        kind: "failed",
        message:
          message === "payment_required"
            ? "Unlock this job to generate it."
            : message,
      });
    }
  }

  /**
   * Run every job that can be generated, a couple at a time.
   *
   * Sequential would make a five-job run a five-minute wait; unbounded would
   * fire five 90-second LLM calls at once and invite rate limits. Two is the
   * compromise, and each call is an independent request, so one failure never
   * takes the others down.
   */
  /**
   * Every entry point that spends something splits into a guard and a body.
   * `redFlagsAck` is React state, so it is not readable on the line after
   * setRedFlagsAck(true) — the modal therefore calls the *Acknowledged body
   * directly rather than re-entering the guard it just satisfied.
   */
  function needsAck(forJobs: RunJob[]): boolean {
    return !redFlagsAck && forJobs.some((j) => j.dealbreakerHits.length > 0);
  }

  async function runAll() {
    if (running) return;
    if (needsAck(jobs)) {
      setPendingAction({ kind: "all" });
      return;
    }
    await runAllAcknowledged();
  }

  /**
   * @param allowSample give the run's one free preview to the first unpaid job
   *   in the queue. False when the user asked to spend credits on a specific
   *   set: they had just deselected the other jobs, and quietly building one of
   *   them anyway spends a free daily generation on a job they said no to.
   *   The free preview stays one click away on its own button.
   */
  async function runAllAcknowledged(allowSample = true) {
    if (running) return;
    setRunning(true);
    setError("");
    trackButtonClick({
      button_name: "run_generate_all",
      action: "generate",
      button_text: "Generate",
      click_source: "run_workspace",
    });

    // A job is generatable when it is paid, or when it is the run's one
    // free preview. Recomputed here rather than captured, so a credit spent
    // mid-run is picked up on the next pass.
    const anySample = jobs.some((j) => j.isSample);
    const queue = jobs.filter((j) => !j.hasResult);
    let sampleTaken = anySample || !allowSample;

    const tasks = queue.map((job) => {
      const paid = Boolean(job.tier);
      const asSample = !paid && !sampleTaken;
      if (asSample) sampleTaken = true;
      return { job, paid, asSample };
    });
    const runnable = tasks.filter((t) => t.paid || t.asSample);

    let cursor = 0;
    async function worker() {
      while (cursor < runnable.length) {
        const task = runnable[cursor++];
        await runOne(task.job, task.asSample);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, runnable.length) }, worker)
    );

    setRunning(false);
    router.refresh();
  }

  /* ---------------- unlocking ---------------- */

  async function unlock(job: RunJob) {
    // Spending a credit is not undoable, so a job that clashes with the
    // user's dealbreakers asks first — the same gate the bulk run uses.
    if (needsAck([job])) {
      setPendingAction({ kind: "unlock", jobId: job.id });
      return;
    }
    await unlockAcknowledged(job);
  }

  async function unlockAcknowledged(job: RunJob) {
    setRow(job.id, { kind: "unlocking" });
    setError("");
    const result = await spendCreditOnJob(job.id);
    if (!result.ok) {
      setRow(job.id, { kind: "idle" });
      setError(result.message);
      if (result.outOfCredits) void refreshCredits();
      return;
    }
    setCredits(result.balance);
    patchJob(job.id, { tier: "full" });
    // The job is paid now — generate it (or unlock its preview in place,
    // which /api/generate does without another LLM call).
    await runOne({ ...job, tier: "full" }, false);
    router.refresh();
  }

  /** Spend a credit on each SELECTED job, then generate them. */
  async function unlockSelected() {
    if (needsAck(selectedJobs)) {
      setPendingAction({ kind: "unlockSelected" });
      return;
    }
    await unlockSelectedAcknowledged();
  }

  async function unlockSelectedAcknowledged() {
    setError("");
    let unlocked = 0;
    for (const job of selectedJobs) {
      if (job.tier) continue;
      const result = await spendCreditOnJob(job.id);
      if (!result.ok) {
        // The balance can move under a stale tab, so the atomic spend is still
        // the authority — this message is what the user sees when it says no.
        if (result.outOfCredits) {
          setError(
            `You ran out of credits after unlocking ${unlocked} of ${selectedJobs.length} jobs.`
          );
        } else {
          setError(result.message);
        }
        break;
      }
      unlocked++;
      setCredits(result.balance);
      patchJob(job.id, { tier: "full" });
    }
    // Only what was just paid for — see allowSample.
    await runAllAcknowledged(false);
  }

  /* ---------------- design ---------------- */

  /**
   * Commit a design chosen in the preview modal.
   *
   * Three writes, because a design has three homes: the device default, the
   * account default, and the generations already built in this run. Skipping
   * the last one is what would make Apply a lie — the batch download prints
   * each job from its own stored row, so an unpatched run keeps saving PDFs in
   * the old design however emphatically the user picked a new one.
   */
  async function applyDesign(choice: DesignChoice) {
    setDesignBusy(true);
    setError("");
    trackButtonClick({
      button_name: "apply_design",
      action: "select",
      button_text: "Use this design",
      click_source: "run_workspace",
    });
    rememberExportPrefs(choice);
    void saveAccountPrefs({
      defaultTemplate: choice.template,
      export: choice,
    });
    try {
      const res = await fetch(`/api/run/${runId}/design`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(choice),
      });
      // A run with nothing generated yet has no rows to patch, and that is not
      // a failure — the preference is saved and the next CV picks it up.
      if (!res.ok && ready.length > 0) {
        const data = await readJson(res);
        throw new Error(data?.error ?? "Could not apply that design");
      }
      setDesignSeed(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not apply that design");
    } finally {
      setDesignBusy(false);
    }
  }

  async function buyPack(quantity: PackQuantity) {
    setPackBusy(true);
    setError("");
    try {
      await startPackCheckout(quantity, `/run/${runId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPackBusy(false);
    }
  }

  /* ---------------- download ---------------- */

  /**
   * Resolves the pending `mount` once React has committed the new print target
   * AND the browser has had a frame to lay it out.
   *
   * Without this the queue prints whatever was already in the DOM — the same
   * CV saved N times under N different names, which looks like the download
   * worked right up until the user opens the files.
   */
  useEffect(() => {
    if (!printMount) return;
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        mountResolve.current?.();
        mountResolve.current = null;
      });
    });
    return () => cancelAnimationFrame(outer);
  }, [printMount]);

  function mountForPrint(item: PrintQueueItem): Promise<void> {
    return new Promise((resolve) => {
      mountResolve.current = resolve;
      setPrintMount(item);
    });
  }

  async function downloadAll() {
    if (downloading) return;
    setDownloading(true);
    setError("");
    trackButtonClick({
      button_name: "run_download_all",
      action: "download",
      button_text: "Download all",
      click_source: "run_workspace",
    });
    try {
      const res = await fetch(`/api/run/${runId}/documents`, {
        cache: "no-store",
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error ?? "Could not load your files");

      const documents = (data.documents ?? []) as RunDocument[];
      const byJob: Record<string, RunDocument> = {};
      for (const d of documents) byJob[d.jobId] = d;
      setDocs(byJob);

      // CV then report, job by job, in the order they appear on screen — so
      // the save dialogs arrive in the order the user is looking at.
      const items: PrintQueueItem[] = [];
      for (const job of jobs) {
        const doc = byJob[job.id];
        if (!doc) continue;
        items.push({
          jobId: job.id,
          target: "cv",
          name: candidateName,
          company: doc.company || job.company,
        });
        if (doc.simulation) {
          items.push({
            jobId: job.id,
            target: "report",
            name: candidateName,
            company: doc.company || job.company,
          });
        }
      }
      if (items.length === 0) {
        throw new Error("Nothing to download yet.");
      }

      setQueueTotal(items.length);
      setSavedCount(0);
      await printQueue(items, mountForPrint, (saved, total, next) => {
        setSavedCount(saved);
        setQueueLabel(next ? printItemLabel(next) : "");
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
      setPrintMount(null);
      setQueueLabel("");
    }
  }

  /* ---------------- render ---------------- */

  const activeDoc = printMount ? docs[printMount.jobId] : null;
  const needCredits = Math.max(0, unpaid.length - credits.total);
  /**
   * Nothing bought, nothing built yet: this is the moment right after the
   * questions, so the offer leads instead of sitting under the job list.
   */
  const paywallLeads = needCredits > 0 && generated === 0 && credits.total === 0;
  const paywallEl = needCredits > 0 && (
    <div className={paywallLeads ? "mt-6" : "mt-8"}>
      <h2 className="mb-3 text-center text-lg font-semibold text-ink">
        {paywallLeads
          ? `Unlock your ${unpaid.length} tailored CV${unpaid.length === 1 ? "" : "s"}`
          : "Unlock the rest"}
      </h2>
      <BundlePaywall
        defaultQuantity={
          isPackQuantity(needCredits) ? (needCredits as PackQuantity) : 5
        }
        busy={packBusy}
        onSelect={buyPack}
        hint={
          paywallLeads
            ? `You added ${unpaid.length} job${unpaid.length === 1 ? "" : "s"}. ${freeMode() ? "Take" : "Buy"} fewer credits than that and you choose which ones we build.`
            : `${needCredits} job${needCredits === 1 ? "" : "s"} still locked.`
        }
      />
      {/* Seeing the 21 designs is a reason to buy, so the way to see them sits
          with the offer as well as up in the action row. */}
      <p className="mt-3 text-center text-xs text-ink-faint">
        <button
          className="cursor-pointer font-semibold text-accent underline"
          onClick={openDesign}
        >
          See what the designs look like →
        </button>
      </p>
    </div>
  );

  return (
    <div className="mx-auto max-w-[820px] px-6 pb-16 pt-4">
      <div className="print:hidden">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight text-ink">
          Your applications
        </h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          {jobs.length} job{jobs.length === 1 ? "" : "s"}, one CV tailored to
          each.
        </p>

        {/* Overall progress */}
        <Card className="mt-5 p-5">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">
              {generated} of {jobs.length} generated
            </p>
            {credits.total > 0 && (
              <Badge tone="green">
                {credits.total} credit{credits.total === 1 ? "" : "s"} left
              </Badge>
            )}
          </div>
          <ProgressBar
            value={generated}
            max={jobs.length}
            label={`${generated} of ${jobs.length} CVs generated`}
          />

          {/* How the credits on hand are being spread across the run. Only
              worth saying when there is an allocation to make — with enough
              credits for everything the checkboxes are all ticked anyway. */}
          {credits.total > 0 && lockedIds.length > 0 && (
            <p className="mt-3 text-[13px] font-semibold text-ink-soft">
              {selected.size} of {credits.total} credit
              {credits.total === 1 ? "" : "s"} allocated
              {lockedIds.length > credits.total && (
                <span className="font-normal text-ink-faint">
                  {" "}
                  · {lockedIds.length} jobs locked, so pick the{" "}
                  {credits.total} you want built
                </span>
              )}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {credits.total > 0 && selected.size > 0 && (
              <Button
                loading={running}
                loadingLabel="Generating…"
                onClick={unlockSelected}
              >
                Generate {selected.size} report
                {selected.size === 1 ? "" : "s"}
              </Button>
            )}
            {jobs.some((j) => !j.hasResult) && (
              <Button
                variant={
                  credits.total > 0 && selected.size > 0 ? "outline" : "primary"
                }
                loading={running}
                loadingLabel="Generating…"
                onClick={runAll}
              >
                {/* The free-preview wording is only honest when nothing has
                    been generated AND nothing has been paid for — a run
                    bought upfront goes straight to generating, no preview. */}
                {previews.length === 0 && ready.length === 0 && unpaid.length === jobs.length
                  ? "Start with a free preview"
                  : "Generate the rest"}
              </Button>
            )}
            {ready.length > 0 && (
              <Button
                variant="outline"
                loading={downloading}
                loadingLabel="Saving…"
                onClick={downloadAll}
              >
                Download all ({fileCount} file{fileCount === 1 ? "" : "s"})
              </Button>
            )}
            {/* Always available: the designs are worth seeing before you buy,
                not only once there is a document to restyle. */}
            <Button variant="outline" onClick={openDesign}>
              Preview designs
            </Button>
          </div>

          {downloading && queueTotal > 0 && (
            <div className="mt-4">
              <ProgressBar
                value={savedCount}
                max={queueTotal}
                label={`${savedCount} of ${queueTotal} files saved`}
              />
              <p className="mt-2 text-[12.5px] text-ink-soft">
                Saving {Math.min(savedCount + 1, queueTotal)} of {queueTotal}
                {queueLabel ? ` — ${queueLabel}` : ""}. Each file opens its own
                save dialog, already named for the employer.
              </p>
            </div>
          )}

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </Card>

        {/* Not enough credits and nothing built yet — this is the moment
            straight after the questions, so the offer leads the page. */}
        {paywallLeads && paywallEl}

        {/* Job rows */}
        <div className="mt-4 space-y-3">
          {jobs.map((job, i) => {
            const state = rows[job.id] ?? { kind: "idle" };
            const status = rowStatus(job, state);
            /**
             * Only a locked job is up for allocation. A paid or generated one
             * is already committed, and a checkbox next to it would suggest
             * the user could take that decision back.
             */
            const selectable = status === "locked" && credits.total > 0;
            const isSelected = selected.has(job.id);
            const blocked = selectable && !isSelected && allocationFull;
            return (
              <Card key={job.id} className="flex flex-wrap items-center gap-3 p-4">
                {selectable && (
                  <label
                    className={`flex items-center ${
                      blocked ? "cursor-not-allowed" : "cursor-pointer"
                    }`}
                    title={
                      blocked
                        ? "No credits left — untick another job first"
                        : "Spend one credit on this job"
                    }
                  >
                    <input
                      type="checkbox"
                      className="h-[18px] w-[18px] cursor-pointer accent-[var(--color-accent,#2F7A5A)] disabled:cursor-not-allowed"
                      checked={isSelected}
                      disabled={blocked || running}
                      onChange={() => toggleSelected(job.id)}
                      aria-label={`Generate ${job.company || `job ${i + 1}`}`}
                    />
                  </label>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">
                    {job.company || `Job ${i + 1}`}
                    {job.title && (
                      <span className="font-normal text-ink-faint">
                        {" "}
                        · {job.title}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-ink-faint">
                    {status === "ready" && "CV + interview report ready"}
                    {status === "preview" &&
                      "Free preview — watermarked, not downloadable"}
                    {status === "locked" &&
                      (blocked
                        ? "No credits left for this one"
                        : isSelected
                          ? "Selected — 1 credit"
                          : "Waiting to be unlocked")}
                    {status === "queued" && "Paid — ready to generate"}
                    {status === "generating" && "Tailoring your CV… (30–90s)"}
                    {status === "unlocking" && "Applying your credit…"}
                    {status === "failed" && state.kind === "failed" && (
                      <span className="text-red-600">{state.message}</span>
                    )}
                  </p>
                  {job.dealbreakerHits.length > 0 && (
                    <p className="mt-0.5 text-[12.5px] font-medium text-amber-800">
                      {job.dealbreakerHits.length} thing
                      {job.dealbreakerHits.length === 1 ? "" : "s"} here clash
                      with your dealbreakers.
                    </p>
                  )}
                </div>

                {status === "ready" && <Badge tone="green">Ready</Badge>}
                {status === "preview" && <Badge tone="amber">Preview</Badge>}
                {status === "locked" && <Badge tone="slate">Locked</Badge>}
                {status === "queued" && <Badge tone="indigo">Queued</Badge>}

                {(status === "locked" || status === "preview") &&
                  credits.total > 0 && (
                    <Button
                      size="sm"
                      loading={state.kind === "unlocking"}
                      loadingLabel="Unlocking…"
                      disabled={running}
                      onClick={() => unlock(job)}
                    >
                      Use 1 credit
                    </Button>
                  )}
                {status === "failed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => runOne(job, !job.tier && previews.length === 0)}
                  >
                    Retry
                  </Button>
                )}
                {job.hasResult && (
                  <Link
                    href={`/jobs/${job.id}`}
                    className="inline-flex cursor-pointer items-center justify-center rounded-full border-[1.5px] border-border-strong bg-transparent px-[22px] py-[9px] text-sm font-semibold text-ink-soft transition-all duration-150 hover:bg-card"
                  >
                    Open
                  </Link>
                )}
              </Card>
            );
          })}
        </div>

        {/* Once something has been bought or built, the offer demotes to
            below the list, sized to what is actually still locked. */}
        {!paywallLeads && paywallEl}
      </div>

      {/* Dealbreaker acknowledgement, once for the whole run. Acknowledging
          resumes whatever the user was trying to do. */}
      <Modal
        open={pendingAction !== null}
        onClose={() => setPendingAction(null)}
        title="Some jobs clash with your dealbreakers"
      >
        <p className="text-sm text-ink-soft">
          {redFlagJobs.length} of these {jobs.length} jobs contain something you
          told us is a dealbreaker. We can still tailor a CV for each of them —
          we just want you to see it first.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-ink-soft">
          {redFlagJobs.map((j) => (
            <li key={j.id}>
              • <strong>{j.company}</strong> — {j.dealbreakerHits.length} match
              {j.dealbreakerHits.length === 1 ? "" : "es"}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPendingAction(null)}>
            Let me review them
          </Button>
          <Button
            onClick={() => {
              const action = pendingAction;
              setRedFlagsAck(true);
              setPendingAction(null);
              if (!action) return;
              if (action.kind === "all") {
                void runAllAcknowledged();
                return;
              }
              if (action.kind === "unlockSelected") {
                void unlockSelectedAcknowledged();
                return;
              }
              const job = jobs.find((j) => j.id === action.jobId);
              if (job) void unlockAcknowledged(job);
            }}
          >
            Continue anyway
          </Button>
        </div>
      </Modal>

      {designOpen && (
        <DesignPreviewModal
          jdText={jobs.map((j) => `${j.title} ${j.company}`).join(" ")}
          busy={designBusy}
          onApply={applyDesign}
          onClose={() => setDesignSeed(null)}
        />
      )}

      {/* The one document currently being printed. Exactly one CV and at most
          one report is ever in the DOM — see mountForPrint. */}
      {activeDoc &&
        printMount?.target === "cv" &&
        (() => {
          // Theme and split used to be dropped here, so every batch download
          // printed light and non-split however the user had set the design.
          const template = asTemplate(activeDoc.template) ?? DEFAULT_TEMPLATE;
          return (
            <div className="print-cv-holder cv-print-reset">
              <CvRenderer
                cv={activeDoc.cv}
                template={template}
                theme={asCvTheme(activeDoc.cvTheme) ?? "light"}
                split={effectiveSplit(template, activeDoc.splitView)}
              />
            </div>
          );
        })()}
      {activeDoc && printMount?.target === "report" && activeDoc.simulation && (
        <ReportPage
          results={{
            cv: activeDoc.cv,
            diff: activeDoc.diff,
            simulation: activeDoc.simulation,
            jobTitle: activeDoc.title,
            company: activeDoc.company,
          }}
          candidateName={candidateName}
        />
      )}
    </div>
  );
}

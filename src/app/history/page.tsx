"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  FunnelState,
  STEP_ORDER,
  activateFlow,
  clearFunnel,
  flowDisplayName,
  loadFunnel,
  loadHistory,
  removeFromHistory,
  saveFunnel,
  updateHistoryEntry,
} from "@/lib/funnel";
import { downloadBoth } from "@/lib/download";
import { useCredits } from "@/lib/use-credits";
import { Badge, Button, Card, Toast } from "@/components/ui";
import { LoadingAnnounce, Skeleton, SkeletonRows } from "@/components/skeleton";
import { Navbar } from "@/components/navbar";
import { useSession } from "@/lib/use-session";

/** A flow saved server-side (see GET /api/jobs). */
type SavedJob = {
  id: string;
  title: string;
  company: string;
  /** User's rename; "" falls back to the derived title · company label. */
  displayName: string;
  createdAt: string;
  hasResult: boolean;
  isSample: boolean;
  tier: string | null;
  /** Set when the unlock came from a bundle credit. */
  orderId?: string | null;
};

/** Max length for a user-chosen process name (PRD 4.5.6). */
const MAX_PROCESS_NAME = 50;

/** Human title for a flow: an explicit rename wins, else the derived default. */
function flowTitle(f: FunnelState): string {
  return flowDisplayName(f);
}

/** History order — newest first, matching what the server returns. */
function sortJobs(js: SavedJob[]): SavedJob[] {
  return [...js].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Same rule for an account-saved job: rename → company · title → fallback. */
function jobTitle(j: SavedJob): string {
  if (j.displayName.trim()) return j.displayName.trim();
  const parts = [j.company.trim(), j.title.trim()].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Untitled job";
}

/**
 * The shared inline rename input, used by both the account-saved list and the
 * on-device list. Enter commits, clicking away commits, Escape reverts.
 *
 * Enter commits DIRECTLY rather than by calling blur() and letting the blur
 * handler do it: a programmatic blur does not reliably fire a blur event when
 * the window itself isn't focused, which silently swallowed the rename. The
 * `done` flag then stops the blur that follows from committing a second time.
 */
function InlineRename({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <input
      autoFocus
      maxLength={MAX_PROCESS_NAME}
      aria-label="Process name"
      className="min-w-0 max-w-full rounded-md border border-indigo-400 bg-surface px-2 py-0.5 text-[15.5px] font-bold text-ink outline-none focus:ring-2 focus:ring-indigo-300"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

/**
 * Inline "this click registered" hint for a row that navigates.
 *
 * Must be rendered INSIDE the <Link> — useLinkStatus reads the pending state
 * of its nearest Link ancestor. Fixed size with a toggled opacity rather than
 * a mounted/unmounted spinner, so a row never reflows when it lights up. With
 * jobs/[id]/loading.tsx in place the shell is prefetched and this usually
 * stays dark; it covers the case where prefetch hasn't landed yet.
 */
function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`h-3.5 w-3.5 shrink-0 rounded-full border-2 border-border border-t-accent transition-opacity duration-150 ${
        pending ? "animate-spin opacity-100" : "opacity-0"
      }`}
    />
  );
}

/** The ✎ affordance that opens an inline rename. */
function RenameButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      aria-label="Rename this process"
      title="Rename"
      className="shrink-0 cursor-pointer rounded-full px-1.5 py-0.5 text-sm text-muted transition-colors hover:text-indigo-600"
      onClick={onClick}
    >
      ✎
    </button>
  );
}

/** The ✕ affordance that deletes a row. */
function DeleteButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className="cursor-pointer rounded-full px-2 py-1 text-sm text-muted transition-colors hover:text-red-700"
      onClick={onClick}
    >
      ✕
    </button>
  );
}

/**
 * The History tab: every flow ever started (a flow = one CV upload).
 * Incomplete flows resume at the exact step they stopped at; completed
 * flows re-download their stored deliverables — separate buttons once the
 * bundle was downloaded, one unified button before that (mirrors Results).
 */
export default function HistoryPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState<FunnelState | null>(null);
  const [history, setHistory] = useState<FunnelState[]>([]);
  // Saved flows live in Supabase once a user is signed in; the localStorage
  // list below only ever knew about flows that never got that far.
  const { signedIn, loading: sessionLoading } = useSession();
  const [jobs, setJobs] = useState<SavedJob[] | null>(null);
  // Tracked separately from `jobs === null`, which cannot tell "not fetched
  // yet" from "signed out". Without it the page renders blank — and then
  // flashes the "No flows yet" empty state — while /api/jobs is in flight.
  const [jobsLoading, setJobsLoading] = useState(true);
  useEffect(() => {
    if (!signedIn) {
      setJobs(null);
      setJobsLoading(false);
      return;
    }
    let alive = true;
    setJobsLoading(true);
    fetch("/api/jobs")
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((d) => alive && setJobs(d.jobs ?? []))
      .catch(() => alive && setJobs([]))
      .finally(() => alive && setJobsLoading(false));
    return () => {
      alive = false;
    };
  }, [signedIn]);
  // The flow being printed — rendered into hidden print targets first.
  const [printJob, setPrintJob] = useState<{ flow: FunnelState } | null>(null);

  // Inline process renaming (PRD Topic 4) — one id at a time across both
  // lists; local flow ids and job uuids never collide.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  // A soft-deleted account job, held for the Undo window.
  const [deletedJob, setDeletedJob] = useState<SavedJob | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The row whose Resume / download is in flight, so only that row goes busy.
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [resumePending, startResume] = useTransition();
  /** Unlock credits left to spend. Signed-in only. */
  const { balance: credits, loaded: creditsLoaded } = useCredits(signedIn);

  function refresh() {
    const f = loadFunnel();
    setActive(f?.profile ? f : null);
    setHistory(loadHistory());
  }

  /** PRD 4.5.6 — an empty name flashes a warning and keeps the old one. */
  function rejectEmptyName(id: string) {
    setRenameError(id);
    setTimeout(() => setRenameError(null), 1600);
    setEditingId(null);
  }

  /** Persists to the active flow or the archived entry, whichever holds it. */
  function persistName(flow: FunnelState, name: string) {
    const current = loadFunnel();
    if (current?.profile && current.flowId === flow.flowId) {
      saveFunnel({ ...current, processName: name });
    } else {
      updateHistoryEntry(flow.flowId, { processName: name });
    }
    refresh();
  }

  function commitRename(flow: FunnelState, raw: string) {
    const name = raw.trim().slice(0, MAX_PROCESS_NAME);
    if (!name) {
      rejectEmptyName(flow.flowId);
      return;
    }
    persistName(flow, name);
    setEditingId(null);
  }

  /* ---------------- account-saved jobs: rename + soft delete --------- */

  /** Optimistic rename; the server is the source of truth on reload. */
  async function commitJobRename(job: SavedJob, raw: string) {
    const name = raw.trim().slice(0, MAX_PROCESS_NAME);
    if (!name) {
      rejectEmptyName(job.id);
      return;
    }
    setEditingId(null);
    setJobs((js) =>
      (js ?? []).map((j) => (j.id === job.id ? { ...j, displayName: name } : j))
    );
    try {
      await fetch(`/api/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
    } catch {
      // Network hiccup — put the old name back rather than lie about it.
      setJobs((js) =>
        (js ?? []).map((j) => (j.id === job.id ? { ...j, displayName: job.displayName } : j))
      );
    }
  }

  /**
   * Deletion is soft server-side, so this is reversible: the row goes away
   * immediately and an Undo toast can restore it for a few seconds.
   */
  async function removeJob(job: SavedJob) {
    const paid = Boolean(job.tier);
    if (
      paid &&
      !confirm(
        `"${jobTitle(job)}" is a job you paid for. Remove it from your History? ` +
          `Your purchase record is kept, and you can undo this right away.`
      )
    ) {
      return;
    }
    setJobs((js) => (js ?? []).filter((j) => j.id !== job.id));
    setDeletedJob(job);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setDeletedJob(null), 6000);
    try {
      await fetch(`/api/jobs/${job.id}`, { method: "DELETE" });
    } catch {
      setJobs((js) => sortJobs([...(js ?? []), job]));
      setDeletedJob(null);
    }
  }

  async function undoRemoveJob() {
    const job = deletedJob;
    if (!job) return;
    setDeletedJob(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setJobs((js) => sortJobs([...(js ?? []), job]));
    await fetch(`/api/jobs/${job.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deletedAt: null }),
    }).catch(() => setJobs((js) => (js ?? []).filter((j) => j.id !== job.id)));
  }

  useEffect(() => {
    refresh();
    setHydrated(true);
  }, []);

  // The files are rendered server-side now, so this no longer depends on a
  // hidden CvRenderer being in the DOM first — it just hands the stored flow
  // over and flags the downloads.
  useEffect(() => {
    if (!printJob) return;
    const { flow } = printJob;
    if (!flow.results) {
      setPrintJob(null);
      return;
    }
    void downloadBoth({
      meta: {
        name: flow.profile?.contact.fullName ?? "",
        company: flow.results.company ?? "",
      },
      cv: flow.results.cv,
      template: flow.template,
      theme: flow.cvTheme,
      split: flow.splitView,
      diff: flow.results.diff,
      simulation: flow.results.simulation,
      jobTitle: flow.results.jobTitle ?? "",
      company: flow.results.company ?? "",
    }).catch(() => {
      /* the toast below already told the user a download was starting */
    });

    // Both files always travel together, so both flags always move together.
    // They stay two fields rather than one so existing saved flows keep
    // reading correctly — see FunnelState in src/lib/funnel.ts.
    const flags = { downloadedCv: true, downloadedReport: true };
    const current = loadFunnel();
    if (current?.profile && current.flowId === flow.flowId) {
      saveFunnel({ ...current, ...flags });
    } else {
      updateHistoryEntry(flow.flowId, flags);
    }
    refresh();
    setPrintJob(null);
  }, [printJob]);

  /**
   * Makes the flow active and lands on its furthest reached step.
   *
   * The transition is what gives the clicked row something to show: the
   * localStorage write is instant but "/" is a heavy client page, so the row
   * used to sit there looking untouched until the new page painted.
   */
  function resume(flow: FunnelState) {
    const stepIdx = Math.min(
      Math.max(flow.furthestStep ?? 0, STEP_ORDER.indexOf(flow.step)),
      STEP_ORDER.length - 1
    );
    setResumingId(flow.flowId);
    activateFlow({ ...flow, step: STEP_ORDER[stepIdx] });
    startResume(() => router.push("/"));
  }

  /**
   * Deleting the ACTIVE flow used to be impossible — the ✕ was hidden for it,
   * so the one row a user most often wants gone was the one they were stuck
   * with. Clearing the funnel is the equivalent operation for that row.
   */
  function remove(flow: FunnelState, isActive: boolean) {
    if (
      !confirm(
        isActive
          ? `Delete "${flowTitle(flow)}"? This clears the flow in progress on this device.`
          : `Delete "${flowTitle(flow)}" from your history?`
      )
    ) {
      return;
    }
    if (isActive) clearFunnel();
    removeFromHistory(flow.flowId);
    refresh();
  }

  // Render function, not a component — a new component type per render
  // would remount every row (see card/page.tsx).
  function flowRow(flow: FunnelState, isActive: boolean) {
    const completed = Boolean(flow.results);
    const bothDownloaded = flow.downloadedCv && flow.downloadedReport;
    const stepNum =
      Math.min(flow.furthestStep ?? 0, STEP_ORDER.length - 1) + 1;
    const isEditing = editingId === flow.flowId;
    const isResuming = resumePending && resumingId === flow.flowId;
    // Printing goes through a render-then-print effect, so the click and the
    // print dialog are a beat apart — the button has to say so meanwhile.
    const isPrinting = printJob?.flow.flowId === flow.flowId;
    return (
      <Card key={flow.flowId || "active"} className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {isEditing ? (
                <InlineRename
                  initial={flowTitle(flow)}
                  onCommit={(name) => commitRename(flow, name)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <button
                  className="min-w-0 cursor-pointer truncate text-left text-[15.5px] font-bold text-ink hover:underline"
                  onClick={() => resume(flow)}
                  title={
                    completed ? "Open this flow" : "Resume where you left off"
                  }
                >
                  {flowTitle(flow)}
                </button>
              )}
              {!isEditing && (
                <RenameButton
                  onClick={() => {
                    setRenameError(null);
                    setEditingId(flow.flowId);
                  }}
                />
              )}
              {isActive && <Badge tone="indigo">Active</Badge>}
              {completed ? (
                <Badge tone="green">Completed ✓</Badge>
              ) : (
                <Badge tone="amber">
                  In progress · step {stepNum}/{STEP_ORDER.length}
                </Badge>
              )}
            </div>
            {renameError === flow.flowId && (
              <p className="mt-1 text-[12px] font-medium text-red-600">
                Name can’t be empty — reverted to the previous name.
              </p>
            )}
            <button
              className="mt-1 block cursor-pointer text-left text-[12.5px] text-ink-faint"
              onClick={() => resume(flow)}
            >
              {flow.savedAt
                ? new Date(flow.savedAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : ""}
              {completed && bothDownloaded && " · files downloaded"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {completed ? (
              <Button
                size="sm"
                variant={bothDownloaded ? "outline" : "primary"}
                loading={isPrinting}
                loadingLabel="Opening…"
                onClick={() => setPrintJob({ flow })}
              >
                {bothDownloaded
                  ? "Download again (2 PDFs)"
                  : "Download my files (2 PDFs)"}
              </Button>
            ) : (
              <Button
                size="sm"
                loading={isResuming}
                loadingLabel="Opening…"
                onClick={() => resume(flow)}
              >
                Resume →
              </Button>
            )}
            <DeleteButton
              label="Delete from history"
              onClick={() => remove(flow, isActive)}
            />
          </div>
        </div>
      </Card>
    );
  }

  const flows = [
    ...(active ? [{ flow: active, isActive: true }] : []),
    ...history
      .filter((f) => f.flowId !== active?.flowId)
      .map((f) => ({ flow: f, isActive: false })),
  ];

  /* Nothing is knowable until localStorage is read AND — for a signed-in
     user — /api/jobs has answered. Both lists and the empty state stay
     behind this, so the page never shows "No flows yet" to someone who has
     flows. */
  const loading = !hydrated || sessionLoading || (signedIn && jobsLoading);

  return (
    <main className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-[720px] px-6 pb-16 pt-4">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight text-ink">
          History
        </h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          Every flow you started — a new one begins each time you upload a
          CV. Resume incomplete flows or re-download finished files.
        </p>
        {signedIn && (
          <p className="mt-2 text-[13px] text-ink-soft">
            Applying to several roles at once?{" "}
            <Link href="/" className="font-semibold text-accent underline">
              Start a new application
            </Link>{" "}
            — add up to 5 jobs, answer one questionnaire, get a tailored CV for
            each.
          </p>
        )}

        {/* Credits — account-wide, so they belong above the list rather than
            repeated on every row that could use them. */}
        {!loading && signedIn && creditsLoaded && credits.total > 0 && (
          <Card className="mt-6 flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {credits.total} unlock{credits.total === 1 ? "" : "s"} left
              </p>
              <p className="mt-0.5 text-[12.5px] text-ink-soft">
                Open any unfinished job to spend one — no extra charge.
              </p>
            </div>
            <Link
              href="/my-account"
              className="text-[12.5px] font-semibold text-accent underline"
            >
              Manage credits
            </Link>
          </Card>
        )}
        {loading && (
          <div className="mt-6">
            <LoadingAnnounce label="Loading your flows…" />
            <Skeleton className="h-3 w-40" />
            <SkeletonRows
              className="mt-3"
              count={3}
              render={() => (
                <Card className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="mt-2 h-3 w-24" />
                  </div>
                  <Skeleton className="h-9 w-24 rounded-full" />
                  <Skeleton className="h-8 w-8 rounded-full" />
                </Card>
              )}
            />
          </div>
        )}

        {/* Saved flows (server-side). These are the ones that reached an
            account — the localStorage list below never knew about them. */}
        {!loading && signedIn && jobs !== null && jobs.length > 0 && (
          <div className="mt-6">
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-ink-faint">
              Saved to your account
            </h2>
            <div className="mt-2 space-y-3">
              {jobs.map((j) => (
                <Card key={j.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {editingId === j.id ? (
                        <InlineRename
                          initial={jobTitle(j)}
                          onCommit={(name) => commitJobRename(j, name)}
                          onCancel={() => setEditingId(null)}
                        />
                      ) : (
                        <>
                          {/* A Link, not a router.push: /jobs/[id] is dynamic,
                              and Next only prefetches such a route when it is
                              reached through a Link AND has a loading boundary
                              (it now has one). That prefetch is what makes the
                              click feel instant. */}
                          <Link
                            href={`/jobs/${j.id}`}
                            className="flex min-w-0 items-center gap-1.5 font-bold text-ink hover:underline"
                            title="Open this job"
                          >
                            <span className="min-w-0 truncate text-left">
                              {jobTitle(j)}
                            </span>
                            <LinkPending />
                          </Link>
                          <RenameButton
                            onClick={() => {
                              setRenameError(null);
                              setEditingId(j.id);
                            }}
                          />
                        </>
                      )}
                    </div>
                    {renameError === j.id && (
                      <p className="mt-1 text-[12px] font-medium text-red-600">
                        Name can’t be empty — reverted to the previous name.
                      </p>
                    )}
                    <p className="mt-0.5 text-[12.5px] text-ink-faint">
                      {new Date(j.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  {j.tier ? (
                    <Badge tone="indigo">Purchased</Badge>
                  ) : j.isSample ? (
                    <Badge tone="amber">Preview</Badge>
                  ) : !j.hasResult ? (
                    <Badge tone="amber">Not finished</Badge>
                  ) : null}
                  <Link
                    href={`/jobs/${j.id}`}
                    className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border-[1.5px] border-border-strong bg-transparent px-[22px] py-[9px] text-sm font-semibold text-ink-soft transition-all duration-150 hover:bg-card"
                  >
                    {j.hasResult ? "Open" : "Continue"}
                    <LinkPending />
                  </Link>
                  <DeleteButton
                    label="Remove from history"
                    onClick={() => removeJob(j)}
                  />
                </Card>
              ))}
            </div>
            {flows.length > 0 && (
              <h2 className="mt-8 text-[13px] font-bold uppercase tracking-wide text-ink-faint">
                On this device
              </h2>
            )}
          </div>
        )}

        <div className="mt-6 space-y-3">
          {!loading && flows.length === 0 && !(jobs && jobs.length > 0) && (
            <Card className="p-10 text-center">
              <span className="text-3xl">🗂️</span>
              <h2 className="mt-3 text-xl font-bold text-ink">No flows yet</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
                Upload your CV and a job posting on the homepage — your flows
                will appear here, resumable any time.
              </p>
              <Button size="lg" className="mt-5" onClick={() => router.push("/")}>
                Start my first flow
              </Button>
            </Card>
          )}
          {!loading && flows.map(({ flow, isActive }) => flowRow(flow, isActive))}
        </div>
      </div>

      {deletedJob && (
        <Toast
          message={`"${jobTitle(deletedJob)}" removed`}
          actionLabel="Undo"
          onAction={undoRemoveJob}
        />
      )}

      {/* The hidden CvRenderer/ReportPage that used to live here — the print
          dialog's only way to see the document — are gone: /api/pdf renders
          each file server-side from the flow that is posted to it. */}
    </main>
  );
}

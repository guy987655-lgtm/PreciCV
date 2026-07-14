"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  FunnelState,
  STEP_ORDER,
  activateFlow,
  flowDisplayName,
  loadFunnel,
  loadHistory,
  removeFromHistory,
  saveFunnel,
  updateHistoryEntry,
} from "@/lib/funnel";
import { printBoth, printFile } from "@/lib/download";
import { Badge, Button, Card } from "@/components/ui";
import { Navbar } from "@/components/navbar";
import { CvRenderer } from "@/components/cv-renderer";
import { ReportPage } from "@/components/report-page";

type PrintTarget = "cv" | "report" | "both";

/** Max length for a user-chosen process name (PRD 4.5.6). */
const MAX_PROCESS_NAME = 50;

/** Human title for a flow: an explicit rename wins, else the derived default. */
function flowTitle(f: FunnelState): string {
  return flowDisplayName(f);
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
  // The flow being printed — rendered into hidden print targets first.
  const [printJob, setPrintJob] = useState<{
    flow: FunnelState;
    target: PrintTarget;
  } | null>(null);

  // Inline process renaming (PRD Topic 4).
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(
    null
  );
  const [renameError, setRenameError] = useState<string | null>(null);
  // Set on Esc so the input's blur handler doesn't also commit the revert.
  const cancelledRef = useRef(false);

  function refresh() {
    const f = loadFunnel();
    setActive(f?.profile ? f : null);
    setHistory(loadHistory());
  }

  function startRename(flow: FunnelState) {
    setRenameError(null);
    setEditing({ id: flow.flowId, value: flowDisplayName(flow) });
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

  function commitRename(flow: FunnelState) {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    if (!editing || editing.id !== flow.flowId) return;
    const name = editing.value.trim().slice(0, MAX_PROCESS_NAME);
    if (!name) {
      // PRD 4.5.6 — flash a warning and revert to the previous valid name.
      setRenameError(flow.flowId);
      setTimeout(() => setRenameError(null), 1600);
      setEditing(null);
      return;
    }
    persistName(flow, name);
    setEditing(null);
  }

  function cancelRename() {
    cancelledRef.current = true;
    setEditing(null);
  }
  useEffect(() => {
    refresh();
    setHydrated(true);
  }, []);

  // The hidden CvRenderer/ReportPage for printJob.flow are in the DOM by
  // the time this effect runs — print, flag the downloads, clean up.
  useEffect(() => {
    if (!printJob) return;
    const { flow, target } = printJob;
    if (!flow.results) {
      setPrintJob(null);
      return;
    }
    const meta = {
      name: flow.profile?.contact.fullName,
      company: flow.results.company,
    };
    if (target === "both") printBoth(meta);
    else printFile(target, meta);

    const flags =
      target === "cv"
        ? { downloadedCv: true }
        : target === "report"
          ? { downloadedReport: true }
          : { downloadedCv: true, downloadedReport: true };
    const current = loadFunnel();
    if (current?.profile && current.flowId === flow.flowId) {
      saveFunnel({ ...current, ...flags });
    } else {
      updateHistoryEntry(flow.flowId, flags);
    }
    refresh();
    setPrintJob(null);
  }, [printJob]);

  /** Makes the flow active and lands on its furthest reached step. */
  function resume(flow: FunnelState) {
    const stepIdx = Math.min(
      Math.max(flow.furthestStep ?? 0, STEP_ORDER.indexOf(flow.step)),
      STEP_ORDER.length - 1
    );
    activateFlow({ ...flow, step: STEP_ORDER[stepIdx] });
    router.push("/");
  }

  function remove(flow: FunnelState) {
    if (!confirm(`Delete "${flowTitle(flow)}" from your history?`)) return;
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
    const isEditing = editing?.id === flow.flowId;
    return (
      <Card key={flow.flowId || "active"} className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {isEditing ? (
                <input
                  autoFocus
                  maxLength={MAX_PROCESS_NAME}
                  className="min-w-0 max-w-full rounded-md border border-indigo-400 bg-surface px-2 py-0.5 text-[15.5px] font-bold text-ink outline-none focus:ring-2 focus:ring-indigo-300"
                  value={editing?.value ?? ""}
                  onChange={(e) =>
                    setEditing({ id: flow.flowId, value: e.target.value })
                  }
                  onBlur={() => commitRename(flow)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
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
                <button
                  aria-label="Rename this process"
                  title="Rename"
                  className="shrink-0 cursor-pointer rounded-full px-1.5 py-0.5 text-sm text-muted transition-colors hover:text-indigo-600"
                  onClick={() => startRename(flow)}
                >
                  ✎
                </button>
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
              {flow.results?.company ? ` · ${flow.results.company}` : ""}
              {completed && bothDownloaded && " · files downloaded"}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {completed ? (
              bothDownloaded ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPrintJob({ flow, target: "cv" })}
                  >
                    CV (PDF)
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPrintJob({ flow, target: "report" })}
                  >
                    Report (PDF)
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  onClick={() => setPrintJob({ flow, target: "both" })}
                >
                  Download my files (2 PDFs)
                </Button>
              )
            ) : (
              <Button size="sm" onClick={() => resume(flow)}>
                Resume →
              </Button>
            )}
            {!isActive && (
              <button
                aria-label="Delete from history"
                className="cursor-pointer rounded-full px-2 py-1 text-sm text-muted transition-colors hover:text-red-700"
                onClick={() => remove(flow)}
              >
                ✕
              </button>
            )}
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

        <div className="mt-6 space-y-3">
          {hydrated && flows.length === 0 && (
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
          {flows.map(({ flow, isActive }) => flowRow(flow, isActive))}
        </div>
      </div>

      {/* Hidden print targets for the flow being downloaded */}
      {printJob?.flow.results && (
        <>
          <div className="print-cv-holder">
            <CvRenderer
              cv={printJob.flow.results.cv}
              template={printJob.flow.template || "classic"}
            />
          </div>
          <ReportPage
            results={printJob.flow.results}
            candidateName={printJob.flow.profile?.contact.fullName || ""}
          />
        </>
      )}
    </main>
  );
}

import { PrintDoc, pdfFileName } from "./pdf-doc";

/**
 * Downloading the deliverables.
 *
 * This used to be `window.print()` against a hidden DOM node, with
 * document.title standing in for the filename. That broke the expectation a
 * Download button sets, and worse: on a Mac with no printer configured the
 * dialog's Print button is disabled outright, so the files the user had just
 * paid for could not be saved at all. It also meant N files were N dialogs,
 * each needing the caller to swap the printed document into the DOM first and
 * wait for a paint.
 *
 * Now the server renders each document in headless Chrome (see /api/pdf) and
 * this just saves what comes back. Real text, no dialog, and no choreography
 * — every caller simply hands over the document it already holds.
 */

/** Everything about a document except which of its two files to render. */
export type PrintPayload = Omit<PrintDoc, "target">;

/** Space between saves — browsers throttle bursts of programmatic downloads. */
const SAVE_GAP_MS = 350;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPdf(
  target: "cv" | "report",
  payload: PrintPayload
): Promise<Blob> {
  const res = await fetch("/api/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, target }),
  });
  if (!res.ok) {
    let message = "We couldn't build your PDF. Please try again in a moment.";
    try {
      const data = await res.json();
      if (data?.message || data?.error) message = data.message ?? data.error;
    } catch {
      // Non-JSON error body — the default sentence is better than nothing.
    }
    throw new Error(message);
  }
  return res.blob();
}

/** Hands a blob to the browser as a named file. */
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** One file, saved. */
export async function downloadPdf(
  target: "cv" | "report",
  payload: PrintPayload
): Promise<void> {
  const blob = await fetchPdf(target, payload);
  save(blob, pdfFileName(target, payload.meta));
}

/**
 * The CV and its interview report.
 *
 * The report is skipped when there is nothing to build it from — a truncated
 * model response occasionally leaves a generation with no change analysis, and
 * handing over a hollow second file is worse than handing over one good one.
 */
export async function downloadBoth(payload: PrintPayload): Promise<void> {
  await downloadPdf("cv", payload);
  if (!payload.diff) return;
  await sleep(SAVE_GAP_MS);
  await downloadPdf("report", payload);
}

export type DownloadQueueItem = {
  /** Identifies the row this file belongs to — used for progress labels. */
  key: string;
  target: "cv" | "report";
  payload: PrintPayload;
};

/**
 * Several files, one after another.
 *
 * Sequential on purpose: each render occupies a browser page server-side, and
 * a burst of parallel downloads is also what browsers throttle. The progress
 * callback is what the caller shows instead of a stack of dialogs.
 */
export async function downloadQueue(
  items: DownloadQueueItem[],
  onProgress?: (saved: number, total: number, next?: DownloadQueueItem) => void
): Promise<void> {
  const unnamed = items.find((it) => !it.payload.meta.company.trim());
  if (unnamed) {
    throw new Error(
      "Every file needs the hiring company's name before it can be saved."
    );
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i, items.length, item);
    await downloadPdf(item.target, item.payload);
    if (i < items.length - 1) await sleep(SAVE_GAP_MS);
  }
  onProgress?.(items.length, items.length);
}

/** Human label for a queued file — "Acme · Interview report". */
export function downloadItemLabel(item: DownloadQueueItem): string {
  return `${item.payload.meta.company} · ${
    item.target === "report" ? "Interview report" : "CV"
  }`;
}

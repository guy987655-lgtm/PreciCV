/**
 * Print-to-PDF download helpers. The browser names the saved PDF after
 * document.title, so the title IS the filename:
 *
 *   CV     → SpeCV-Guy-Ratzon-PayPal
 *   Report → SpeCV-Guy-Ratzon-PayPal-Interview-Report
 *
 * This deliberately carries no timestamp. An earlier version appended one to
 * dodge the OS "replace existing file?" prompt, but the noise meant users
 * renamed the file by hand before attaching it to an application — a
 * predictable name is worth the occasional replace prompt on re-download.
 * The report keeps its suffix so "download both" cannot emit two files with
 * the same name. The body class picks which print target (.cv-page vs
 * .report-page) becomes visible — see globals.css.
 */

function slug(s: string): string {
  return s.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

export function printFile(
  target: "cv" | "report",
  meta: { name?: string; company?: string }
) {
  const parts = [
    "SpeCV",
    slug(meta.name || "candidate"),
    meta.company ? slug(meta.company) : "",
    // Only the report is qualified; the CV gets the bare, expected name.
    target === "report" ? "Interview-Report" : "",
  ].filter(Boolean);

  const prevTitle = document.title;
  document.title = parts.join("-");
  document.body.classList.toggle("print-report", target === "report");
  try {
    window.print();
  } finally {
    document.body.classList.remove("print-report");
    document.title = prevTitle;
  }
}

/**
 * One click → both files, but strictly one dialog at a time.
 *
 * These used to be two back-to-back `window.print()` calls on the assumption
 * that each blocks until its dialog closes. It does not hold: the second
 * dialog could open while the first was still up, and — worse — clicks the
 * user made *while* a dialog was open were queued by the browser and all
 * replayed at once on dismiss, firing a burst of print dialogs. The second
 * file now waits for `afterprint`, with a timeout fallback for browsers that
 * do not fire it. Resolves once both have been handed to the browser.
 */
export function printBoth(meta: {
  name?: string;
  company?: string;
}): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const second = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", onAfterPrint);
      clearTimeout(fallback);
      // A beat for the first dialog to tear down; opening the second inside
      // the afterprint handler itself is ignored by some browsers.
      setTimeout(() => {
        printFile("report", meta);
        resolve();
      }, 350);
    };
    const onAfterPrint = () => second();
    window.addEventListener("afterprint", onAfterPrint);
    const fallback = setTimeout(second, 60_000);
    printFile("cv", meta);
  });
}

/* ------------------------------------------------------------------ */
/* Multi-job download                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolves once the current print dialog has been dismissed.
 *
 * The listener has to be attached BEFORE window.print() — some browsers fire
 * `afterprint` synchronously enough that registering afterwards misses it and
 * the queue stalls for the full 60s fallback. Same 60s escape hatch and 350ms
 * teardown beat as printBoth, for the same reasons.
 */
function waitForPrintDone(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.removeEventListener("afterprint", onAfterPrint);
      clearTimeout(fallback);
      setTimeout(resolve, 350);
    };
    const onAfterPrint = () => finish();
    window.addEventListener("afterprint", onAfterPrint);
    const fallback = setTimeout(finish, 60_000);
  });
}

export type PrintQueueItem = {
  /** The job this file belongs to — passed back to `mount`. */
  jobId: string;
  target: "cv" | "report";
  /** Candidate name for the filename. */
  name: string;
  /** Hiring company. Required — see the invariant in printQueue. */
  company: string;
};

/**
 * Save several files in a row, strictly one dialog at a time.
 *
 * `mount` is the important half. printFile prints whatever `.cv-page` /
 * `.report-page` element is in the DOM, so with N jobs the caller MUST swap
 * the mounted document before each file and let React paint it — otherwise
 * every dialog silently saves the same CV under N different names. The caller
 * implements `mount` as "set the active job, then await a paint"; this
 * function just guarantees it is awaited before the dialog opens.
 *
 * The company name is a hard invariant rather than a defaulted field: these
 * files exist to be told apart, and a folder of "SpeCV-Guy-Ratzon.pdf",
 * "SpeCV-Guy-Ratzon(1).pdf" is exactly the outcome a multi-job run is meant to
 * prevent. The homepage makes the name mandatory before a run can be created,
 * so reaching this throw means a bug upstream, not user input.
 */
export async function printQueue(
  items: PrintQueueItem[],
  mount: (item: PrintQueueItem) => Promise<void>,
  onProgress?: (saved: number, total: number, next?: PrintQueueItem) => void
): Promise<void> {
  const unnamed = items.find((it) => !it.company.trim());
  if (unnamed) {
    throw new Error(
      "Every file needs the hiring company's name before it can be saved."
    );
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i, items.length, item);
    await mount(item);
    const done = waitForPrintDone();
    printFile(item.target, { name: item.name, company: item.company });
    await done;
  }
  onProgress?.(items.length, items.length);
}

/** Human label for a queued file — "Acme · Interview report". */
export function printItemLabel(item: PrintQueueItem): string {
  return `${item.company} · ${item.target === "report" ? "Interview report" : "CV"}`;
}

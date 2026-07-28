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

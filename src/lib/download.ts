/**
 * Print-to-PDF download helpers. The browser names the saved PDF after
 * document.title, so a unique timestamped title per file prevents the OS
 * "replace existing file?" prompt. The body class picks which print
 * target (.cv-page vs .report-page) becomes visible — see globals.css.
 */

function slug(s: string): string {
  return s.trim().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

export function printFile(
  target: "cv" | "report",
  meta: { name?: string; company?: string }
) {
  const stamp = new Date()
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, "-"); // e.g. 2026-07-06-14-32-08 — unique per second
  const parts = [
    "SpeCV",
    target === "cv" ? "CV" : "Interview-Report",
    slug(meta.name || "candidate"),
    meta.company ? slug(meta.company) : "",
    stamp,
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

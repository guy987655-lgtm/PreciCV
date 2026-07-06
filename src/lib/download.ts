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
    window.print(); // blocks until the dialog is dismissed
  } finally {
    document.body.classList.remove("print-report");
    document.title = prevTitle;
  }
}

/** One click → both files: the second dialog opens as the first closes. */
export function printBoth(meta: { name?: string; company?: string }) {
  printFile("cv", meta);
  printFile("report", meta);
}

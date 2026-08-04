"use client";

import { useEffect, useState } from "react";
import type { PrintDoc } from "@/lib/pdf-doc";
import { effectiveSplit } from "@/lib/templates";
import { CvRenderer } from "@/components/cv-renderer";
import { ReportPage } from "@/components/report-page";

declare global {
  interface Window {
    /** Chrome calls this with the document to lay out (see /api/pdf). */
    __setPrintDoc?: (doc: PrintDoc) => void;
    /** Flipped once layout has stopped moving — the signal to print. */
    __printReady?: boolean;
  }
}

/** Frames the measurement has to repeat before layout counts as settled. */
const STABLE_FRAMES = 3;
/** Never hang: print what we have rather than time the whole request out. */
const SETTLE_TIMEOUT_MS = 8_000;

/**
 * The page headless Chrome prints from.
 *
 * It renders the SAME components the app renders on screen — that is the whole
 * point. The 21 designs lean on flexbox, CSS grid, negative margins and, most
 * of all, CvRenderer's measure-and-reflow loop that shrinks type until the CV
 * fits one A4 page. All of that is browser layout, so the only faithful way to
 * produce a PDF is to let a browser do it. Chrome's own PDF output is real,
 * selectable text, which is what makes the file ATS-parseable.
 *
 * It holds no data of its own and fetches nothing: the document is injected by
 * the PDF route after the page loads. Anyone who opens this URL directly gets
 * a blank page.
 */
export default function PrintPage() {
  const [doc, setDoc] = useState<PrintDoc | null>(null);

  useEffect(() => {
    window.__printReady = false;
    window.__setPrintDoc = (next) => setDoc(next);
    return () => {
      delete window.__setPrintDoc;
    };
  }, []);

  // The existing print CSS picks its target off this class — the same switch
  // the browser print dialog used (globals.css).
  useEffect(() => {
    if (!doc) return;
    document.body.classList.toggle("print-report", doc.target === "report");
  }, [doc]);

  /**
   * Wait for layout to stop moving before declaring the page printable.
   *
   * CvRenderer rescales font size and leading over several passes until the
   * content fits the page, and web fonts change the metrics it measures. A
   * fixed delay would either print a half-fitted CV or add seconds to every
   * download, so this watches the rendered size instead and stops as soon as
   * it repeats.
   */
  useEffect(() => {
    if (!doc) return;
    let raf = 0;
    let last = "";
    let stable = 0;
    let cancelled = false;

    const measure = () => {
      const el = document.querySelector<HTMLElement>(
        doc.target === "report" ? ".report-page" : ".cv-page"
      );
      if (!el) return "";
      const cs = getComputedStyle(el);
      return `${el.scrollHeight}:${el.offsetWidth}:${cs.fontSize}:${cs.lineHeight}`;
    };

    const tick = () => {
      if (cancelled) return;
      const now = measure();
      if (now && now === last) stable++;
      else {
        stable = 0;
        last = now;
      }
      if (stable >= STABLE_FRAMES) {
        window.__printReady = true;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const timeout = setTimeout(() => {
      window.__printReady = true;
      cancelled = true;
    }, SETTLE_TIMEOUT_MS);

    // Fonts first: they change every metric the fit loop reads.
    const fonts = document.fonts?.ready ?? Promise.resolve();
    void fonts.then(() => {
      if (!cancelled) raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      cancelAnimationFrame(raf);
    };
  }, [doc]);

  if (!doc) return null;

  if (doc.target === "report") {
    if (!doc.diff) return null;
    return (
      <ReportPage
        results={{
          cv: doc.cv,
          diff: doc.diff,
          simulation: doc.simulation ?? { pitch: "", questions: [] },
          jobTitle: doc.jobTitle,
          company: doc.company,
        }}
        candidateName={doc.meta.name}
      />
    );
  }

  return (
    /* cv-print-reset: nothing between .cv-page and <body> may become its
       containing block, or the sheet prints outside the page box entirely
       (the warning in globals.css). */
    <div className="cv-print-reset">
      <CvRenderer
        cv={doc.cv}
        template={doc.template}
        theme={doc.theme}
        split={effectiveSplit(doc.template, doc.split)}
      />
    </div>
  );
}

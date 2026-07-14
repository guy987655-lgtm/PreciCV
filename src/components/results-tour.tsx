"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";

/**
 * First-visit guided tour of the Results page (PRD v2 Topic 4): dims the
 * page, spotlights one control at a time (elements tagged with a
 * `data-tour` attribute) and steps through with Next / Skip. Steps whose
 * target isn't mounted (e.g. the AI-section toggle on CVs without that
 * section) are skipped automatically. Dependency-free by design.
 */

/** localStorage flag — set once the tour completes or is dismissed. */
export const RESULTS_TOUR_KEY = "precicv_results_tour_v1";

export type TourStep = {
  /** Matches a `data-tour="…"` attribute on the Results page. */
  target: string;
  text: string;
};

/** The 6-step Results sequence (order per PRD v2 §4.5). */
export const RESULTS_TOUR_STEPS: TourStep[] = [
  { target: "design", text: "Here you can change the design of your CV." },
  { target: "theme", text: "Switch between light and dark backgrounds." },
  { target: "split", text: "Splits the page into two views." },
  {
    target: "ai-section",
    text: "Toggle a dedicated section for jobs involving AI.",
  },
  {
    target: "edit",
    text: "Edit your CV inline — click any text to change it.",
  },
  { target: "download", text: "Download your final files from here." },
];

const TIP_W = 300;

function findTarget(name: string): Element | null {
  const el = document.querySelector(`[data-tour="${name}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? el : null;
}

export function ResultsTour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  onClose: () => void;
}) {
  // The steps whose target is actually mounted and visible. Resolved with a
  // short retry window (not a one-shot mount measurement): dev-mode remounts
  // and late layout passes can transiently report zero-sized targets, so we
  // keep probing until every target is found or ~1.2s passes — whatever is
  // still missing then (e.g. the AI-section toggle on CVs without that
  // section) is genuinely absent and its step is skipped.
  const [present, setPresent] = useState<TourStep[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    let t: ReturnType<typeof setTimeout>;
    const resolve = () => {
      if (cancelled) return;
      // Layout not ready (zero-width viewport, e.g. a hidden/embedded tab):
      // wait without burning retries — measurements would be meaningless.
      if (document.documentElement.clientWidth === 0) {
        t = setTimeout(resolve, 150);
        return;
      }
      const found = steps.filter((s) => findTarget(s.target) !== null);
      if (found.length === steps.length || tries >= 8) setPresent(found);
      else {
        tries++;
        t = setTimeout(resolve, 150);
      }
    };
    t = setTimeout(resolve, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [steps]);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = present?.[idx];
  const isLast = present !== null && idx === present.length - 1;

  const measure = useCallback(() => {
    if (!step) return;
    const el = findTarget(step.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  // Bring the target into view, then keep its viewport rect fresh (the
  // interval follows the smooth scroll; resize is covered explicitly).
  useEffect(() => {
    if (!step) return;
    findTarget(step.target)?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
    measure();
    const t = setInterval(measure, 120);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(t);
      window.removeEventListener("resize", measure);
    };
  }, [step, measure]);

  // Nothing to tour (no targets mounted) → end silently (deferred so the
  // parent state update never lands mid-render).
  useEffect(() => {
    if (present === null || present.length > 0) return;
    const t = setTimeout(onClose, 0);
    return () => clearTimeout(t);
  }, [present, onClose]);

  if (!step || !rect || present === null) return null;

  // Tooltip below the target when there's room, otherwise above.
  const below = rect.bottom + 150 < window.innerHeight;
  const tipTop = below ? rect.bottom + 14 : undefined;
  const tipBottom = below ? undefined : window.innerHeight - rect.top + 14;
  const tipLeft = Math.min(
    Math.max(rect.left + rect.width / 2 - TIP_W / 2, 8),
    window.innerWidth - TIP_W - 8
  );

  // Spotlight window (target rect + breathing room), clamped to the viewport.
  const pad = 6;
  const win = {
    left: Math.max(rect.left - pad, 0),
    top: Math.max(rect.top - pad, 0),
    right: Math.min(rect.right + pad, window.innerWidth),
    bottom: Math.min(rect.bottom + pad, window.innerHeight),
  };
  const dim = "absolute bg-ink/55 transition-all duration-200";

  return (
    <div className="fixed inset-0 z-[65] print:hidden">
      {/* Click-catcher: the page is inert while the tour runs. */}
      <div className="absolute inset-0" />
      {/* Dim everything EXCEPT the target — four rectangles around the
          spotlight window (a huge box-shadow gets clipped by the engine). */}
      <div className={dim} style={{ left: 0, top: 0, right: 0, height: win.top }} />
      <div className={dim} style={{ left: 0, top: win.bottom, right: 0, bottom: 0 }} />
      <div className={dim} style={{ left: 0, top: win.top, width: win.left, height: win.bottom - win.top }} />
      <div className={dim} style={{ left: win.right, top: win.top, right: 0, height: win.bottom - win.top }} />
      {/* Accent ring around the spotlit control. */}
      <div
        className="pointer-events-none absolute rounded-xl border-2 border-card/90 transition-all duration-200"
        style={{
          left: win.left,
          top: win.top,
          width: win.right - win.left,
          height: win.bottom - win.top,
        }}
      />
      {/* Step tooltip */}
      <div
        className="absolute rounded-2xl bg-card p-4 shadow-[0_12px_40px_rgba(30,43,36,0.3)]"
        style={{ left: tipLeft, top: tipTop, bottom: tipBottom, width: TIP_W }}
        role="dialog"
        aria-label="Results page tour"
      >
        <button
          aria-label="Dismiss the tour"
          onClick={onClose}
          className="absolute right-2.5 top-2 cursor-pointer rounded-full px-1.5 text-base font-bold text-ink-faint hover:text-ink"
        >
          ×
        </button>
        <p className="pr-5 text-[14px] leading-relaxed text-ink">{step.text}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11.5px] font-semibold text-ink-faint">
            {idx + 1} / {present.length}
          </span>
          <div className="flex items-center gap-2.5">
            {!isLast && (
              <button
                onClick={onClose}
                className="cursor-pointer text-[12.5px] font-semibold text-ink-faint hover:text-ink-soft"
              >
                Skip tour
              </button>
            )}
            <Button
              size="sm"
              onClick={() => (isLast ? onClose() : setIdx((i) => i + 1))}
            >
              {isLast ? "Done" : "Next →"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

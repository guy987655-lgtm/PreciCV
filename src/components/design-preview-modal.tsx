"use client";

import { useEffect, useRef, useState } from "react";
import { CvRenderer } from "@/components/cv-renderer";
import { SplitToggle, ThemeToggle } from "@/components/cv-controls";
import { TemplateCatalog } from "@/components/template-catalog";
import { Button } from "@/components/ui";
import { sampleCv } from "@/lib/sample-cv";
import { effectiveSplit } from "@/lib/templates";
import { DEFAULT_EXPORT_PREFS, type ExportPrefs } from "@/lib/export-prefs";

/** The subset of the export configuration a design choice actually decides. */
export type DesignChoice = Pick<
  ExportPrefs,
  "template" | "cvTheme" | "splitView"
>;

/**
 * Design preview — a sample CV rendered live in whichever design, background
 * and layout the user is trying out, with an explicit "Use this design" to
 * commit.
 *
 * Exists because the run page ("Your applications") lists jobs and sells
 * credits but shows no CV at all: the 21 designs were only discoverable by
 * opening a single job, so people picked a look by generating a document and
 * hoping. Everything here is a draft until Apply — browsing must never mutate
 * the user's saved preferences, or there is no way to look without choosing.
 *
 * A4 is 794 × 1123px at 96dpi. The sheet is scaled to fit its column rather
 * than scrolled, so a whole page is visible while comparing designs.
 */
export function DesignPreviewModal({
  initial,
  jdText = "",
  busy = false,
  onApply,
  onClose,
}: {
  /**
   * The design to open on — normally the user's remembered preferences, so the
   * first thing they see is their own choice rather than "classic".
   *
   * Passed IN rather than read from localStorage here on purpose. Storage has
   * no server-side value, so reading it during render makes this component
   * hydrate differently from the HTML that was sent; the caller reads it in the
   * click handler that opens the modal, where there is no such ambiguity. That
   * also leaves this component pure — it renders exactly what it is given.
   */
  initial?: Partial<DesignChoice>;
  /** Job text for the "Recommended for you" catalog row. */
  jdText?: string;
  busy?: boolean;
  onApply: (choice: DesignChoice) => void;
  onClose: () => void;
}) {
  const A4_W = 794;
  const A4_H = 1123;

  const [draft, setDraft] = useState<DesignChoice>({
    template: initial?.template ?? DEFAULT_EXPORT_PREFS.template,
    cvTheme: initial?.cvTheme ?? DEFAULT_EXPORT_PREFS.cvTheme,
    splitView: initial?.splitView ?? DEFAULT_EXPORT_PREFS.splitView,
  });
  const [scale, setScale] = useState(0.5);
  const sheetCol = useRef<HTMLDivElement | null>(null);
  const closeBtn = useRef<HTMLButtonElement | null>(null);

  // Focus moves into the dialog on open and back to whatever opened it on
  // close, so a keyboard user is not dropped at the top of the page behind it.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    return () => restoreTo?.focus?.();
  }, []);

  useEffect(() => {
    const recalc = () => {
      const col = sheetCol.current;
      const availW = (col?.clientWidth ?? window.innerWidth) - 8;
      const availH = window.innerHeight - 190;
      setScale(Math.max(0.2, Math.min(availW / A4_W, availH / A4_H, 1)));
    };
    recalc();
    window.addEventListener("resize", recalc);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const split = effectiveSplit(draft.template, draft.splitView);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Preview CV designs"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm print:hidden"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-[1100px] flex-col overflow-hidden rounded-[24px] bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <div>
            <h2 className="font-display text-lg font-extrabold text-ink">
              Preview designs
            </h2>
            <p className="text-[12.5px] text-ink-faint">
              Sample CV — your content, your design.
            </p>
          </div>
          <button
            ref={closeBtn}
            aria-label="Close preview"
            onClick={onClose}
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-2xl font-bold text-ink-soft transition-colors hover:bg-chip"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col-reverse overflow-auto md:flex-row">
          {/* Controls. Below the sheet on a phone so the CV leads; a fixed
              rail beside it once there is room for both. */}
          <div className="shrink-0 border-border p-5 md:w-[320px] md:overflow-auto md:border-r">
            <div className="flex flex-wrap items-center gap-2">
              <ThemeToggle
                theme={draft.cvTheme}
                onChange={(cvTheme) => setDraft((d) => ({ ...d, cvTheme }))}
              />
              <SplitToggle
                template={draft.template}
                split={draft.splitView}
                onToggle={(splitView) => setDraft((d) => ({ ...d, splitView }))}
              />
            </div>
            <div className="mt-4">
              {/* `sample` stays false: this is a showcase of what the designs
                  look like, not a locked preview of a paid document. */}
              <TemplateCatalog
                template={draft.template}
                onSelect={(template) => setDraft((d) => ({ ...d, template }))}
                jdText={jdText}
              />
            </div>
          </div>

          {/* The sheet */}
          <div
            ref={sheetCol}
            className="flex min-w-0 flex-1 items-start justify-center bg-bg p-4"
          >
            <div style={{ width: A4_W * scale, height: A4_H * scale }}>
              <div
                style={{
                  width: A4_W,
                  height: A4_H,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              >
                {/* domId={null} is required — a second element with id
                    "cv-page" would break the print target the download uses. */}
                <CvRenderer
                  cv={sampleCv}
                  template={draft.template}
                  theme={draft.cvTheme}
                  split={split}
                  domId={null}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-[12.5px] text-ink-faint">
            Applies to every CV in this run, and to the next one you make.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={busy}
              loadingLabel="Applying…"
              onClick={() => onApply(draft)}
            >
              Use this design
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

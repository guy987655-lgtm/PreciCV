"use client";

import { ReactNode } from "react";
import { AI_SECTION_ID, CvTemplate, TailoredCv } from "@/lib/types";
import { CvTheme } from "@/components/cv-renderer";
import { canToggleSplit, forcedSplit } from "@/lib/templates";

/**
 * Toolbar buttons attached to the CV preview frame — deliberately NOT the
 * rounded-full pill chip, so operational controls read as document tools and
 * never blend into the template-design selectors (PRD Topic 3).
 */
const toolbarBtn =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50";
const toolbarIdle = "text-ink-soft hover:bg-chip";
const toolbarActive = "bg-selected-bg text-accent";

/** The control strip that sits on top of the CV preview frame. */
export function CvToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-2.5 py-1.5 print:hidden">
      {children}
    </div>
  );
}

export function ToolbarDivider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border" />;
}

/** §3.1 — locked during Edit Mode and only meaningful once edits desynced the report. */
export function RefreshReportButton({
  onClick,
  disabled,
  busy,
  stale,
  editing,
}: {
  onClick: () => void;
  disabled: boolean;
  busy: boolean;
  stale: boolean;
  editing: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${toolbarBtn} ${
        stale && !disabled ? toolbarActive : toolbarIdle
      } transition-opacity duration-200`}
      title={
        editing
          ? "Finish editing (Done) to refresh the report"
          : !stale
            ? "Report is up to date"
            : "Rebuild the interview report to match your edits"
      }
    >
      {busy ? "Refreshing…" : "↻ Refresh report"}
    </button>
  );
}

/** Opens the full-screen zoomable CV review. */
export function DisplayReviewButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${toolbarBtn} ${toolbarIdle} transition-opacity duration-200`}
      title={
        disabled
          ? "Finish editing (Done) to open Display Review"
          : "Full-screen review with zoom"
      }
    >
      ⛶ Display review
    </button>
  );
}

/**
 * Split/full toggle constrained by the active template's `splitMode`:
 * templates that only support one layout render a locked, informational chip
 * instead of a toggle (mono/timeline/grid = full only; columnrule = split only).
 */
export function SplitToggle({
  template,
  split,
  onToggle,
}: {
  template: CvTemplate;
  split: boolean;
  onToggle: (next: boolean) => void;
}) {
  if (!canToggleSplit(template)) {
    const locked = forcedSplit(template);
    return (
      <span
        className={`${toolbarBtn} cursor-default text-ink-faint`}
        title={
          locked
            ? "This design always uses the split layout"
            : "This design always uses the full-page layout"
        }
      >
        {locked ? "⿻ Split only" : "▭ Full page only"}
      </span>
    );
  }
  return (
    <button
      onClick={() => onToggle(!split)}
      className={`${toolbarBtn} ${split ? toolbarActive : toolbarIdle}`}
    >
      ⿻ Split view
    </button>
  );
}

/** Light/dark background preview toggle (any design renders on either sheet). */
export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: CvTheme;
  onChange: (t: CvTheme) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-full border border-border">
      {(["light", "dark"] as const).map((th) => (
        <button
          key={th}
          onClick={() => onChange(th)}
          className={`cursor-pointer px-3 py-1 text-xs font-semibold transition-colors ${
            theme === th
              ? "bg-ink text-bg"
              : "bg-card text-ink-soft hover:bg-chip"
          }`}
        >
          {th === "light" ? "☀ Light" : "☾ Dark"}
        </button>
      ))}
    </div>
  );
}

/**
 * §6 — show/hide toggle for the dedicated "AI & Automation Expertise"
 * section. Renders only when the generation produced that section; the
 * choice persists with the CV (hiddenSectionIds) on both storage backends.
 */
export function AiSectionToggle({
  cv,
  onChange,
}: {
  cv: TailoredCv;
  onChange: (next: TailoredCv) => void;
}) {
  if (!cv.sections.some((s) => s.id === AI_SECTION_ID)) return null;
  const hidden = (cv.hiddenSectionIds ?? []).includes(AI_SECTION_ID);
  const toggle = () => {
    const ids = new Set(cv.hiddenSectionIds ?? []);
    if (hidden) ids.delete(AI_SECTION_ID);
    else ids.add(AI_SECTION_ID);
    onChange({ ...cv, hiddenSectionIds: [...ids] });
  };
  return (
    <button
      onClick={toggle}
      className={`${toolbarBtn} ${
        hidden ? "text-ink-faint hover:bg-chip" : toolbarActive
      }`}
      title={
        hidden
          ? "Show the AI & Automation Expertise section"
          : "Hide the AI & Automation Expertise section"
      }
    >
      {hidden ? "◇ AI section: off" : "◈ AI section: on"}
    </button>
  );
}

/**
 * Inline-edit controls: an Edit toggle that becomes Done in edit mode, plus a
 * Reset that reverts to the last saved (pre-edit) state. Saving is realtime,
 * so Done merely exits edit mode — but Reset only activates once the document
 * is dirty (§2.2), and it stays inside Edit Mode.
 */
export function EditToolbar({
  editing,
  onToggleEdit,
  onReset,
  canReset,
}: {
  editing: boolean;
  onToggleEdit: (next: boolean) => void;
  onReset: () => void;
  /** §2.2 isDirty — Reset is unclickable until the first change. */
  canReset: boolean;
}) {
  if (!editing) {
    return (
      <button
        onClick={() => onToggleEdit(true)}
        className={`${toolbarBtn} ${toolbarIdle}`}
      >
        ✎ Edit
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-1">
      <button
        onClick={onReset}
        disabled={!canReset}
        className={`${toolbarBtn} ${toolbarIdle} transition-opacity duration-200`}
        title={
          canReset
            ? "Revert to your last saved state"
            : "No changes yet — Reset activates once you edit"
        }
      >
        ⟲ Reset
      </button>
      <button
        onClick={() => onToggleEdit(false)}
        className={`${toolbarBtn} bg-accent text-on-accent hover:bg-accent-hover`}
      >
        ✓ Done
      </button>
    </div>
  );
}

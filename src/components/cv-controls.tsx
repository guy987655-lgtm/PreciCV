"use client";

import { AI_SECTION_ID, CvTemplate, TailoredCv } from "@/lib/types";
import { CvTheme } from "@/components/cv-renderer";
import { canToggleSplit, forcedSplit } from "@/lib/templates";

const chip =
  "cursor-pointer rounded-full border px-3 py-1 text-xs font-semibold transition-colors";

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
        className={`${chip} cursor-default border-border bg-chip text-ink-faint`}
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
      className={`${chip} ${
        split
          ? "border-accent bg-selected-bg text-accent"
          : "border-border bg-card text-ink-soft hover:bg-chip"
      }`}
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
      className={`${chip} ${
        hidden
          ? "border-border bg-card text-ink-faint"
          : "border-accent bg-selected-bg text-accent"
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
        className={`${chip} border-border bg-card text-ink-soft hover:bg-chip`}
      >
        ✎ Edit
      </button>
    );
  }
  return (
    <div className="inline-flex items-center gap-2">
      <button
        onClick={onReset}
        disabled={!canReset}
        className={`${chip} border-border bg-card text-ink-soft transition-opacity duration-200 hover:bg-chip disabled:pointer-events-none disabled:opacity-50`}
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
        className={`${chip} border-accent bg-accent text-on-accent hover:bg-accent-hover`}
      >
        ✓ Done
      </button>
    </div>
  );
}

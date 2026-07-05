"use client";

import { McqAnswer, OTHER_OPTION } from "@/lib/funnel";
import { McqQuestionnaire } from "@/lib/types";
import { Input } from "@/components/ui";

type McqQuestion = McqQuestionnaire["questions"][number];

/** "None of these"-style options are mutually exclusive with the rest. */
const EXCLUSIVE_RE = /^none( of (these|the above))?$/i;

/**
 * Option rows for one quick-check question ("Sage & Ink", mock 3b).
 * selectType "single" behaves like radio buttons; "ranked" allows several
 * picks with click order = priority, shown as a white number in the
 * leading accent circle. "None of these" clears any other selection.
 * Includes the auto-appended free-text "Other…" choice. Shared by the
 * questionnaire carousel and the User Card dashboard's inline editing.
 */
export function McqOptions({
  question,
  answer,
  onChange,
}: {
  question: McqQuestion;
  answer?: McqAnswer;
  onChange: (next: McqAnswer) => void;
}) {
  const selected = answer?.selected ?? [];
  const ranked = question.selectType === "ranked";

  function toggle(opt: string) {
    const prev = answer ?? { selected: [] };
    let next: string[];
    if (prev.selected.includes(opt)) {
      next = prev.selected.filter((o) => o !== opt);
    } else if (!ranked || EXCLUSIVE_RE.test(opt)) {
      // Single-choice questions and "None of these" replace the selection.
      next = [opt];
    } else {
      // Ranked: append in click order; drop an exclusive pick if present.
      next = [...prev.selected.filter((o) => !EXCLUSIVE_RE.test(o)), opt];
    }
    onChange({ ...prev, selected: next, skipped: false });
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        {[...question.options, OTHER_OPTION].map((opt) => {
          const rank = selected.indexOf(opt);
          const isSel = rank >= 0;
          return (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              className={`flex w-full cursor-pointer items-center gap-3 rounded-[14px] px-4 py-[13px] text-left transition-colors ${
                isSel
                  ? "border-2 border-accent bg-selected-bg"
                  : "border-[1.5px] border-border hover:border-accent-soft"
              }`}
            >
              {isSel ? (
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-xs font-extrabold text-white">
                  {ranked ? rank + 1 : "✓"}
                </span>
              ) : (
                <span className="h-[22px] w-[22px] shrink-0 rounded-full border-2 border-placeholder" />
              )}
              <span
                className={`text-[15px] ${
                  isSel ? "font-semibold text-ink" : "text-ink-soft"
                }`}
              >
                {opt === OTHER_OPTION ? "Other…" : opt}
              </span>
            </button>
          );
        })}
      </div>
      {selected.includes(OTHER_OPTION) && (
        <Input
          className="mt-2"
          placeholder="Tell us in your own words…"
          value={answer?.other ?? ""}
          onChange={(e) =>
            onChange({ ...(answer ?? { selected: [] }), other: e.target.value })
          }
        />
      )}
    </>
  );
}

"use client";

import { McqAnswer, OTHER_OPTION } from "@/lib/funnel";
import { McqQuestionnaire } from "@/lib/types";
import { Input } from "@/components/ui";

type McqQuestion = McqQuestionnaire["questions"][number];

/**
 * Option pills for one quick-check question. EVERY question supports
 * multiple selection: click order = priority, shown as numbered badges
 * once more than one option is chosen. Includes the auto-appended
 * free-text "Other…" choice. Shared by the questionnaire carousel and the
 * User Card dashboard's inline editing.
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

  function toggle(opt: string) {
    const prev = answer ?? { selected: [] };
    const next = prev.selected.includes(opt)
      ? prev.selected.filter((o) => o !== opt)
      : [...prev.selected, opt];
    onChange({ ...prev, selected: next, skipped: false });
  }

  return (
    <>
      <div className="flex flex-wrap gap-2 pt-1.5">
        {[...question.options, OTHER_OPTION].map((opt) => {
          const rank = selected.indexOf(opt);
          const isSel = rank >= 0;
          return (
            <button
              key={opt}
              onClick={() => toggle(opt)}
              className={`relative cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                isSel
                  ? "border-indigo-600 bg-indigo-600 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:border-indigo-400 hover:bg-indigo-50"
              }`}
            >
              {isSel && selected.length > 1 && (
                <span className="absolute -top-2 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[10px] font-bold text-white shadow">
                  {rank + 1}
                </span>
              )}
              {opt === OTHER_OPTION ? "Other…" : opt}
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

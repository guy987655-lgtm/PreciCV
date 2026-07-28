"use client";

import type { TopicBucket } from "@/lib/topics";

/**
 * Category chips for My Card. Purely presentational — the page owns the
 * selection and does the filtering, so a different affordance (tabs, a
 * select) can be swapped in against this same contract.
 *
 * An empty `active` means "All".
 */
export function TopicFilter({
  buckets,
  active,
  onChange,
  total,
}: {
  buckets: TopicBucket[];
  active: string;
  onChange: (topic: string) => void;
  /** Count behind the "All" chip — the unfiltered row count. */
  total: number;
}) {
  // One category is no category: don't spend a row on a filter that can only
  // ever be a no-op.
  if (buckets.length < 2) return null;

  const chips = [{ topic: "", label: "All", count: total }, ...buckets.map((b) => ({
    topic: b.topic,
    label: b.topic,
    count: b.count,
  }))];

  return (
    <div
      role="group"
      aria-label="Filter questions by category"
      // Chips scroll sideways rather than wrapping into a tall block on
      // narrow screens; the negative margin lets them bleed to the edge.
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {chips.map((c) => {
        const selected = c.topic === active;
        return (
          <button
            key={c.topic || "__all"}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(c.topic)}
            className={
              "shrink-0 cursor-pointer rounded-full border-[1.5px] px-3.5 py-1.5 text-[13px] font-semibold transition-colors " +
              (selected
                ? "border-accent bg-accent text-on-accent"
                : "border-border bg-card text-ink-soft hover:bg-chip")
            }
          >
            {c.label}
            <span
              className={
                "ml-1.5 text-[12px] font-medium " +
                (selected ? "text-on-accent/70" : "text-ink-faint")
              }
            >
              {c.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

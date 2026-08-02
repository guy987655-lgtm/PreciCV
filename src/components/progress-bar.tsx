"use client";

/**
 * A determinate progress bar on the shared theme tokens.
 *
 * The design system had no progress primitive — the only precedent was the
 * inline free-quota meter in my-account/page.tsx. The run workspace needs one
 * in three places (generation, unlocking, downloading), so it becomes a component
 * rather than a fourth copy.
 *
 * `label` is what a screen reader announces; the visible caption is the
 * caller's business, because the wording differs per use.
 */
export function ProgressBar({
  value,
  max,
  label,
  tone = "accent",
}: {
  value: number;
  max: number;
  label: string;
  tone?: "accent" | "amber";
}) {
  const safeMax = Math.max(1, max);
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-chip"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className={`h-full rounded-full transition-[width] duration-300 ${
          tone === "amber" ? "bg-amber-500" : "bg-accent"
        }`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

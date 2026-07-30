/**
 * Loading skeletons.
 *
 * History and My Card both fetch on the client, so there is nothing for a
 * route-level `loading.tsx` to suspend on — the placeholder has to live
 * inside the page and be driven by its own fetch state. (The job workspace is
 * the exception: it awaits on the server, so it gets a real
 * app/jobs/[id]/loading.tsx built from these same blocks.) These are pure
 * presentational blocks: the shimmer itself is the `.skeleton` class in
 * globals.css, which also carries the prefers-reduced-motion fallback.
 */

function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={cx("skeleton rounded-md", className)}
      style={style}
    />
  );
}

/**
 * Stacked text bars. The last line is short so a block of them reads as a
 * paragraph rather than a solid rectangle.
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cx("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className="h-3"
          style={{ width: i === lines - 1 ? "55%" : "100%" }}
        />
      ))}
    </div>
  );
}

/**
 * Repeats `render` `count` times and staggers each copy's animation, so a
 * list shimmers as a wave instead of pulsing in lockstep. `--skeleton-delay`
 * is a custom property (those inherit — `animation-delay` does not), read by
 * `.skeleton` in globals.css.
 */
export function SkeletonRows({
  count = 3,
  render,
  className,
}: {
  count?: number;
  render: (i: number) => React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("space-y-3", className)} aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{ "--skeleton-delay": `${i * 120}ms` } as React.CSSProperties}
        >
          {render(i)}
        </div>
      ))}
    </div>
  );
}

/**
 * A screen-reader announcement to pair with the visual skeletons — the
 * blocks themselves are aria-hidden, so without this the page is silent
 * while it loads.
 */
export function LoadingAnnounce({ label }: { label: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      {label}
    </span>
  );
}

/**
 * Placeholder for the report cards (Change report / Match analysis /
 * Interview simulation) while a refresh rebuilds them.
 *
 * Refreshing used to just fade the OLD sections to 25% opacity, which reads
 * as a frozen screen: the same text, still there, just dimmer — nothing says
 * work is happening. Replacing them with moving skeletons plus a visible
 * caption makes the wait legible.
 */
export function ReportSectionsSkeleton({
  cards = 2,
  label = "Rebuilding your report…",
  hint = "Re-reading your edited CV against the job description.",
}: {
  cards?: number;
  label?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2.5 text-[13px] font-semibold text-accent"
      >
        <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent" />
        <span>{label}</span>
      </div>
      <p className="-mt-2 text-[12.5px] text-ink-faint">{hint}</p>
      <SkeletonRows
        className="space-y-4"
        count={cards}
        render={() => (
          <div className="rounded-[18px] border border-border bg-card p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-6 w-14 rounded-full" />
            </div>
            <Skeleton className="mt-4 h-2 w-full rounded-full" />
            <SkeletonText className="mt-4" lines={3} />
            <SkeletonText className="mt-4" lines={2} />
          </div>
        )}
      />
    </div>
  );
}

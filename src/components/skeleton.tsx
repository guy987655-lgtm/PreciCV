/**
 * Loading skeletons.
 *
 * History and My Card both fetch on the client, so there is nothing for a
 * route-level `loading.tsx` to suspend on — the placeholder has to live
 * inside the page and be driven by its own fetch state. These are pure
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

import { Navbar } from "@/components/navbar";
import { LoadingAnnounce, Skeleton, SkeletonText } from "@/components/skeleton";

/**
 * Instant fallback for the job workspace.
 *
 * This route is `force-dynamic` and awaits four Supabase round trips before it
 * renders anything, and per the Next docs a dynamic route with no `loading`
 * boundary is not prefetched AT ALL — so opening a job from History left the
 * user on a frozen History page for seconds with no sign the click registered.
 * With this file Next prefetches the shell up to here, so the skeleton paints
 * immediately and the real content streams in behind it.
 *
 * Deliberately mirrors the workspace's own frame (navbar, title row, the
 * two-pane grid at the same breakpoint) so the swap is a fill-in rather than a
 * relayout.
 */
export default function Loading() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-[1400px] px-4 py-8">
        <LoadingAnnounce label="Opening your tailored CV…" />

        <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-6 w-72" />
          <Skeleton className="h-10 w-40 rounded-full" />
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(320px,2fr)_3fr]">
          {/* Left pane: the report cards */}
          <div className="space-y-4">
            {[0, 1].map((i) => (
              <div
                key={i}
                style={
                  { "--skeleton-delay": `${i * 120}ms` } as React.CSSProperties
                }
                className="rounded-[18px] border border-border bg-card p-5"
              >
                <div className="flex items-center justify-between gap-3">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-6 w-14 rounded-full" />
                </div>
                <SkeletonText className="mt-4" lines={3} />
              </div>
            ))}
          </div>

          {/* Right pane: the design catalog strip and the CV sheet */}
          <div>
            <div className="flex gap-2">
              <Skeleton className="h-16 w-24 rounded-lg" />
              <Skeleton className="h-16 w-24 rounded-lg" />
              <Skeleton className="h-16 w-24 rounded-lg" />
            </div>
            <div className="mt-4 rounded-[18px] border border-border bg-card p-8">
              <Skeleton className="h-7 w-1/2" />
              <Skeleton className="mt-2 h-3 w-1/3" />
              <SkeletonText className="mt-8" lines={4} />
              <SkeletonText className="mt-6" lines={5} />
              <SkeletonText className="mt-6" lines={3} />
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

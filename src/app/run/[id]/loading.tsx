import { Card } from "@/components/ui";
import { LoadingAnnounce, Skeleton, SkeletonRows } from "@/components/skeleton";
import { Navbar } from "@/components/navbar";

/**
 * Skeleton for the run workspace.
 *
 * Also what makes this dynamic route prefetchable: Next does not prefetch a
 * dynamic segment that has no loading boundary, so without this file the
 * "Build my CVs" click sat on a dead page while the server rendered.
 */
export default function RunLoading() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-[820px] px-6 pb-16 pt-4">
        <LoadingAnnounce label="Opening your applications…" />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
        <Card className="mt-5 p-5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-3 h-2 w-full rounded-full" />
          <div className="mt-4 flex gap-2">
            <Skeleton className="h-9 w-36 rounded-full" />
            <Skeleton className="h-9 w-32 rounded-full" />
          </div>
        </Card>
        <SkeletonRows
          className="mt-4 space-y-3"
          count={3}
          render={() => (
            <Card className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="mt-2 h-3 w-32" />
              </div>
              <Skeleton className="h-8 w-20 rounded-full" />
            </Card>
          )}
        />
      </div>
    </main>
  );
}

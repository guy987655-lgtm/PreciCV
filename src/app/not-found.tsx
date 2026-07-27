import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { SiteFooter } from "@/components/site-footer";
import { Button } from "@/components/ui";

/** 404 for unmatched URLs and for any segment that calls `notFound()`. */
export default function NotFound() {
  return (
    // No flex column around <Navbar />: its root carries `mx-auto`, which in a
    // column flex parent collapses it to content width instead of stretching.
    <main className="min-h-screen">
      <Navbar />
      <div className="flex min-h-[62vh] items-center justify-center px-6 py-16">
        <div className="max-w-md text-center">
          <h1 className="font-display text-[28px] font-extrabold leading-tight text-ink">
            This page doesn&rsquo;t exist
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
            The link may be old, or the job may have been deleted. Your saved
            applications are in your history.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Link href="/">
              <Button>Back to start</Button>
            </Link>
            <Link href="/history">
              <Button variant="outline">My applications</Button>
            </Link>
          </div>
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}

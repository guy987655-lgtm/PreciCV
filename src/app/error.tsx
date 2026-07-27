"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { supportMailto } from "@/lib/support";

/**
 * App-wide error boundary. Without this, any render-time throw shows the bare
 * Next.js error screen in production — which to a user is a blank page with no
 * way out and no way to tell us.
 *
 * Next 16 note: the recovery prop is `unstable_retry` (added in 16.2), which
 * re-fetches and re-renders the segment. `reset` only clears the error state
 * without re-fetching, so it is the wrong tool here.
 */
export default function ErrorPage({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[error boundary]", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="font-display text-[28px] font-extrabold leading-tight text-ink">
          Something went wrong on our side
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          Nothing you typed was lost — your answers are saved in this browser.
          Try again, and if it keeps happening, tell us and we&rsquo;ll fix it.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={() => unstable_retry()}>Try again</Button>
          <Link href="/">
            <Button variant="outline">Back to start</Button>
          </Link>
        </div>
        <p className="mt-6 text-[13px] text-ink-faint">
          <a
            href={supportMailto(
              `SpeCV error${error.digest ? ` (ref ${error.digest})` : ""}`
            )}
            className="text-accent underline"
          >
            Report this
          </a>
          {error.digest ? (
            <>
              {" "}
              · reference <span className="font-mono">{error.digest}</span>
            </>
          ) : null}
        </p>
      </div>
    </main>
  );
}

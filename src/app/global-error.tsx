"use client";

import { SUPPORT_EMAIL } from "@/lib/support";
import "./globals.css";

/**
 * Last-resort boundary: this fires when the root layout itself fails, so it
 * replaces the layout entirely and must render its own <html> and <body>.
 * The fonts loaded by the root layout are gone at this point, so the styling
 * here stays deliberately basic and depends only on globals.css tokens.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-bg text-ink">
        <main className="flex min-h-screen items-center justify-center px-6 py-16">
          <div className="max-w-md text-center">
            <h1 className="text-[26px] font-extrabold leading-tight">
              SpeCV couldn&rsquo;t load
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
              This is our fault, not yours. Reloading usually fixes it.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={() => unstable_retry()}
                className="cursor-pointer rounded-full bg-accent px-[22px] py-[9px] text-sm font-bold text-on-accent"
              >
                Reload
              </button>
              <a
                href="/"
                className="rounded-full border-[1.5px] border-border-strong px-[22px] py-[9px] text-sm font-semibold text-ink-soft"
              >
                Back to start
              </a>
            </div>
            <p className="mt-6 text-[13px] text-ink-faint">
              Still broken?{" "}
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="text-accent underline"
              >
                {SUPPORT_EMAIL}
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
      </body>
    </html>
  );
}

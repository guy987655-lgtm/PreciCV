import type { ReactNode } from "react";
import { Navbar } from "@/components/navbar";
import { SiteFooter } from "@/components/site-footer";

/**
 * Shared shell for /privacy, /terms and /refunds. The typography is set here
 * with child selectors because this project has no @tailwindcss/typography —
 * the `prose` classes the old placeholder pages used did nothing.
 */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen">
      <Navbar />
      <article
        className="mx-auto max-w-2xl px-6 py-14 text-[15px] leading-relaxed text-ink-soft
          [&_a]:text-accent [&_a]:underline
          [&_h2]:mt-8 [&_h2]:text-[17px] [&_h2]:font-bold [&_h2]:text-ink
          [&_li]:mt-1.5 [&_p]:mt-3
          [&_strong]:font-semibold [&_strong]:text-ink
          [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5"
      >
        <h1 className="font-display text-[32px] font-extrabold leading-tight text-ink">
          {title}
        </h1>
        <p className="mt-1 text-[13px] text-ink-faint">Last updated {updated}</p>
        {children}
      </article>
      <SiteFooter />
    </main>
  );
}

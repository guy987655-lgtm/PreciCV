"use client";

import { usePathname, useRouter } from "next/navigation";
import { canGoBack } from "@/lib/nav-history";

/** Where each route falls back to when there is no in-app history. */
function parentOf(pathname: string): string {
  if (pathname.startsWith("/jobs/")) return "/history";
  return "/";
}

/** Routes with nothing to go back to, or that are mid-redirect. */
const NO_BACK = ["/", "/continue"];

/**
 * In-app Back.
 *
 * Uses real history when the user got here from inside the app, so Back means
 * what they expect; falls back to an explicit parent route when they landed
 * cold, which is what stops it from exiting the product entirely — the whole
 * point of not making people use the browser's button.
 */
export function BackButton({ href }: { href?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (NO_BACK.includes(pathname)) return null;

  const go = () => {
    // An explicit parent always wins: a job opened from its run should go back
    // to that run even if the user reached it some other way.
    if (href) {
      router.push(href);
      return;
    }
    // The depth is decremented by the popstate this triggers — see
    // nav-history; doing it here as well would double-count.
    if (canGoBack()) {
      router.back();
      return;
    }
    router.push(parentOf(pathname));
  };

  return (
    <button
      onClick={go}
      aria-label="Go back"
      title="Back"
      className="flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1.5 text-[13.5px] font-semibold text-ink-soft transition-colors hover:bg-chip hover:text-ink print:hidden"
    >
      <span aria-hidden>←</span>
      <span className="hidden sm:inline">Back</span>
    </button>
  );
}

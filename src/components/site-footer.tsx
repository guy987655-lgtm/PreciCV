import Link from "next/link";
import { SUPPORT_EMAIL } from "@/lib/support";

/**
 * The shared bottom bar. Every public page needs the legal links and a way to
 * reach a human — a paying user whose generation failed has to have somewhere
 * to write, and Lemon Squeezy requires the policies to be reachable.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border py-8 text-center text-sm text-ink-faint">
      <p>
        SpeCV — English CVs only for now · Your CV data stays in your browser
        until you sign in.
      </p>
      <nav className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
        <Link href="/privacy" className="hover:text-ink-soft hover:underline">
          Privacy
        </Link>
        <Link href="/terms" className="hover:text-ink-soft hover:underline">
          Terms
        </Link>
        <Link href="/refunds" className="hover:text-ink-soft hover:underline">
          Refunds
        </Link>
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="hover:text-ink-soft hover:underline"
        >
          Contact
        </a>
      </nav>
    </footer>
  );
}

import Link from "next/link";
import { TryNow } from "./try-now";

const STEPS = [
  {
    n: "1",
    title: "Tell us once",
    body: "Upload your CV and answer a few sharp questions.",
  },
  {
    n: "2",
    title: "Pick a job",
    body: "Paste the posting. We check it against your dealbreakers first.",
  },
  {
    n: "3",
    title: "Get the one-pager",
    body: "A tailored CV plus a report of what changed and why.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <nav className="mx-auto flex max-w-[1280px] items-center justify-between px-6 py-5 sm:px-14">
        <Link
          href="/"
          className="font-display text-[23px] font-extrabold tracking-tight text-ink"
        >
          Spe<span className="text-accent">CV</span>
        </Link>
        <div className="flex items-center gap-6 text-[15px] font-semibold">
          <a
            href="#how-it-works"
            className="hidden text-ink-soft transition-colors hover:text-ink sm:block"
          >
            How it works
          </a>
          <Link
            href="/card"
            className="text-ink-soft transition-colors hover:text-ink"
          >
            My card
          </Link>
          <span className="rounded-full bg-green-50 px-[15px] py-2 text-[13.5px] font-bold text-accent">
            Free during launch
          </span>
        </div>
      </nav>

      {/* Hero (step 1) or the centered funnel (steps 2-5) — see try-now.tsx */}
      <TryNow />

      {/* Steps band */}
      <section id="how-it-works" className="mt-16 bg-card px-6 py-12 sm:px-14">
        <div className="mx-auto grid max-w-[1280px] gap-10 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n}>
              <div className="font-display text-[34px] font-extrabold text-accent">
                {s.n}
              </div>
              <div className="mt-1.5 text-base font-bold text-ink">{s.title}</div>
              <div className="mt-1 text-[14.5px] leading-relaxed text-ink-soft">
                {s.body}
              </div>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-ink-faint">
        SpeCV — free during launch · English CVs only for now · Your CV
        data stays in your browser.
      </footer>
    </main>
  );
}

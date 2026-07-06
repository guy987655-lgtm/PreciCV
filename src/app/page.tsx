import { Navbar } from "@/components/navbar";
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
      <Navbar />

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

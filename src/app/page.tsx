import Link from "next/link";
import { TIERS } from "@/lib/types";
import { TryNow } from "./try-now";

const features = [
  {
    title: "Master Data Lake",
    body: "Upload your CV once. A dynamic questionnaire extracts the metrics and details recruiters actually look for — stored as your single source of truth.",
  },
  {
    title: "Dealbreaker Radar",
    body: "Tell us your absolute non-negotiables. Every job description is scanned against them before you spend a single credit.",
  },
  {
    title: "One-Page Precision",
    body: "Claude tailors a strict one-page resume for each job, mirroring the JD's language — without ever inventing a fact.",
  },
  {
    title: "Transparent Diff Report",
    body: "See exactly what changed and why, side-by-side: removals in red, additions in green, plus an honest gap analysis.",
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-xl font-bold text-indigo-700">
          PreciCV
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/card"
            className="text-sm font-medium text-slate-600 hover:text-indigo-700"
          >
            My card
          </Link>
          <Link
            href="/login"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Sign in
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-3xl px-6 pt-20 pb-16 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
          Match your CV to the{" "}
          <span className="text-indigo-600">job you actually want</span>
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-lg text-slate-600">
          Upload your CV, paste the job you&apos;re after, and PreciCV bridges
          the gap: a modernized base CV, a custom CV tailored to that job,
          and a report showing exactly what changed and why.
        </p>
      </section>

      {/* Prominent try-before-signup section */}
      <section className="px-6 pb-20">
        <TryNow />
        <p className="mt-4 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link href="/login" className="text-indigo-600 underline">
            Sign in
          </Link>{" "}
          ·{" "}
          <a href="#pricing" className="text-indigo-600 underline">
            Pricing
          </a>
        </p>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-6 pb-20 sm:grid-cols-2">
        {features.map((f) => (
          <div
            key={f.title}
            className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <h3 className="font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-6 pb-24">
        <h2 className="text-center text-3xl font-bold text-slate-900">
          Pay once, at the end. No subscriptions.
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-500">
          Build your profile and add your job for free — you only pay right
          before your documents are generated.
        </p>
        <div className="mt-10 grid gap-6 sm:grid-cols-3">
          {(Object.entries(TIERS) as [string, (typeof TIERS)[keyof typeof TIERS]][]).map(
            ([id, tier]) => (
              <div
                key={id}
                className={`rounded-xl bg-white p-8 ${
                  id === "match"
                    ? "border-2 border-indigo-500 shadow-md"
                    : "border border-slate-200 shadow-sm"
                }`}
              >
                <h3
                  className={`text-lg font-semibold ${
                    id === "match" ? "text-indigo-700" : ""
                  }`}
                >
                  {tier.name}
                </h3>
                <p className="mt-2 text-4xl font-bold">${tier.priceUsd}</p>
                <p className="text-sm text-slate-500">one-time</p>
                <ul className="mt-6 space-y-2 text-sm text-slate-600">
                  {tier.includes.map((line) => (
                    <li key={line}>✓ {line}</li>
                  ))}
                </ul>
              </div>
            )
          )}
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500">
        PreciCV — English CVs only during MVP. Your data is yours: delete it
        anytime from Settings.
      </footer>
    </main>
  );
}

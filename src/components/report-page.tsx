import { GenerationResult } from "@/lib/types";
import { TONE_META } from "@/components/interview-faces";
import { DiffChangeLines } from "@/components/diff-change";

/** SVG donut gauge for the match score — prints in full color. */
function ScoreGauge({ score }: { score: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  return (
    <svg viewBox="0 0 90 90" width="96" height="96" aria-hidden>
      <circle cx="45" cy="45" r={r} fill="none" stroke="#E9EDE2" strokeWidth="11" />
      <circle
        cx="45"
        cy="45"
        r={r}
        fill="none"
        stroke="#2F6B4F"
        strokeWidth="11"
        strokeDasharray={`${filled} ${c - filled}`}
        strokeLinecap="round"
        transform="rotate(-90 45 45)"
      />
      <text
        x="45"
        y="49"
        textAnchor="middle"
        fontSize="22"
        fontWeight="800"
        fill="#1E2B24"
      >
        {score}%
      </text>
    </svg>
  );
}

function PanelTitle({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <h2
      className="text-[13px] font-extrabold uppercase tracking-wide"
      // Never leave a heading orphaned at the foot of a page.
      style={{ color, breakAfter: "avoid" }}
    >
      {children}
    </h2>
  );
}

/**
 * The printable interview simulation report (second deliverable file).
 * Hidden on screen (.report-page in globals.css); printed in full color
 * with charts and comic-style interview scenes per question tone.
 */
export function ReportPage({
  results,
  candidateName,
}: {
  results: GenerationResult;
  candidateName: string;
}) {
  const gap = results.diff.gapAnalysis;
  return (
    <div className="report-page bg-white font-sans text-[12px] leading-relaxed text-slate-900">
      {/* Colored header band */}
      <div className="bg-[#1E2B24] px-[14mm] py-6 text-white">
        <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-[#9DBFA6]">
          Spe<span className="text-white">CV</span> · Match &amp; Interview
          Simulation Report
        </p>
        <h1 className="mt-1 text-[24px] font-extrabold">
          {candidateName || "Candidate"}
        </h1>
        <p className="text-[12px] text-[#C9DFC4]">
          Target role: {results.jobTitle || "—"}
          {results.company ? ` · ${results.company}` : ""} · Generated{" "}
          {new Date().toLocaleDateString("en-GB")}
        </p>
      </div>

      <div className="px-[14mm] py-6">
        {/* Score + verdict row */}
        <div
          className="flex items-center gap-6 rounded-2xl bg-[#F1F6EE] p-4"
          style={{ breakInside: "avoid" }}
        >
          <ScoreGauge score={gap.matchScore} />
          <div>
            <p className="text-[15px] font-extrabold text-[#1E2B24]">
              Match score for this job
            </p>
            <p className="mt-0.5 max-w-[420px] text-[12px] text-slate-600">
              Based on how your real experience lines up with the posting —
              every claim below traces back to your own CV and answers.
            </p>
          </div>
        </div>

        {/* Strengths / gaps side by side */}
        <div className="mt-5 grid grid-cols-2 gap-4">
          {gap.strengths.length > 0 && (
            <div
              className="rounded-2xl border-2 border-[#C9DFC4] bg-[#E4F0DF] p-4"
              style={{ breakInside: "avoid" }}
            >
              <PanelTitle color="#1F4A36">✓ Your strengths</PanelTitle>
              <ul className="mt-1.5 list-disc pl-4 text-[11.5px]">
                {gap.strengths.map((s, i) => (
                  <li key={i} style={{ breakInside: "avoid" }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gap.gaps.length > 0 && (
            <div
              className="rounded-2xl border-2 border-[#F3DCD7] bg-[#FBEFEC] p-4"
              style={{ breakInside: "avoid" }}
            >
              <PanelTitle color="#B04A3A">! Gaps to prepare for</PanelTitle>
              <ul className="mt-1.5 list-disc pl-4 text-[11.5px]">
                {gap.gaps.map((g, i) => (
                  <li key={i} style={{ breakInside: "avoid" }}>
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {gap.recommendations.length > 0 && (
          <div
            className="mt-4 rounded-2xl border-2 border-[#E9EDE2] bg-[#F8FAF5] p-4"
            style={{ breakInside: "avoid" }}
          >
            <PanelTitle color="#2F6B4F">→ Recommendations</PanelTitle>
            <ul className="mt-1.5 list-disc pl-4 text-[11.5px]">
              {gap.recommendations.map((r, i) => (
                <li key={i} style={{ breakInside: "avoid" }}>
                  {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pitch as a speech bubble */}
        {results.simulation.pitch && (
          <div className="mt-6" style={{ breakInside: "avoid" }}>
            <PanelTitle color="#1E2B24">Your 30-second pitch</PanelTitle>
            <div className="relative mt-2 rounded-2xl bg-[#2F6B4F] p-4 text-[12.5px] italic leading-relaxed text-white">
              “{results.simulation.pitch}”
              <span className="absolute -bottom-2 left-8 h-4 w-4 rotate-45 bg-[#2F6B4F]" />
            </div>
          </div>
        )}

        {/* Interview simulation — comic scenes per tone */}
        {results.simulation.questions.length > 0 && (
          <div className="mt-7">
            <PanelTitle color="#1E2B24">
              Interview simulation — what they&apos;ll ask, and how
            </PanelTitle>
            <div className="mt-2 space-y-3">
              {results.simulation.questions.map((q, i) => {
                const meta = TONE_META[q.tone] ?? TONE_META.curious;
                return (
                  <div
                    key={i}
                    className="rounded-2xl border-[1.5px] border-[#E3E9DC] p-3"
                    style={{ breakInside: "avoid" }}
                  >
                    <div className="min-w-0 flex-1">
                      <span
                        className="rounded-full px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide text-white"
                        style={{ background: meta.chip }}
                      >
                        {meta.label}
                      </span>
                      <span className="ml-2 text-[10.5px] italic text-slate-500">
                        {meta.hint}
                      </span>
                      <p className="mt-1 text-[13px] font-bold text-[#1E2B24]">
                        {i + 1}. {q.question}
                      </p>
                      {q.whyTheyAsk && (
                        <p className="text-[11px] italic text-slate-500">
                          Why they ask: {q.whyTheyAsk}
                        </p>
                      )}
                      {q.howToAnswer && (
                        <p className="mt-1 rounded-xl bg-[#F1F6EE] p-2 text-[11.5px] text-[#1F4A36]">
                          <strong>Your move:</strong> {q.howToAnswer}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Change log */}
        {results.diff.changes.length > 0 && (
          <div className="mt-7">
            <PanelTitle color="#1E2B24">
              What we changed in your CV, and why
            </PanelTitle>
            <div className="mt-2 space-y-2">
              {results.diff.changes.map((c, i) => (
                <div key={i} style={{ breakInside: "avoid" }}>
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    {c.section} · {c.type}
                  </p>
                  <DiffChangeLines change={c} />
                  {c.reason && (
                    <p className="text-[11px] italic text-slate-500">{c.reason}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 border-t-2 border-[#E9EDE2] pt-2 text-[10px] text-slate-400">
          Generated by SpeCV — every claim traces back to the candidate&apos;s
          own CV and answers. Nothing was invented.
        </p>
      </div>
    </div>
  );
}

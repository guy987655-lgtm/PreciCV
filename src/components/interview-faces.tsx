import { InterviewTone } from "@/lib/types";

/**
 * Comic-style interview illustrations: interviewer + candidate line-art
 * faces whose expressions reflect the tone of each question — friendly
 * (warm smiles), curious (raised brow, leaning in), challenging (furrowed
 * skeptical interviewer, composed candidate). Pure inline SVG so they
 * print perfectly inside the simulation report.
 */

const STROKE = "#1E2B24";

function Interviewer({ tone }: { tone: InterviewTone }) {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden>
      {/* shirt */}
      <path d="M14 58c1-9 8-13 18-13s17 4 18 13" fill="#2F6B4F" />
      {/* head */}
      <circle cx="32" cy="26" r="15" fill="#F6E7D8" stroke={STROKE} strokeWidth="2" />
      {/* hair */}
      <path d="M18 22c1-8 7-12 14-12s13 4 14 12c-3-4-8-6-14-6s-11 2-14 6z" fill={STROKE} />
      {/* glasses */}
      <circle cx="26" cy="26" r="4.4" fill="none" stroke={STROKE} strokeWidth="1.8" />
      <circle cx="38" cy="26" r="4.4" fill="none" stroke={STROKE} strokeWidth="1.8" />
      <path d="M30.4 26h3.2" stroke={STROKE} strokeWidth="1.8" />
      {tone === "friendly" && (
        <>
          {/* relaxed brows + big smile */}
          <path d="M22 19.5q4-2.5 8 0" fill="none" stroke={STROKE} strokeWidth="1.8" strokeLinecap="round" transform="translate(0,-1)" />
          <path d="M34 18.5q4-2.5 8 0" fill="none" stroke={STROKE} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M25 33q7 6 14 0" fill="none" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      {tone === "curious" && (
        <>
          {/* one raised brow + small open mouth */}
          <path d="M22 20q4-1.5 8 0" fill="none" stroke={STROKE} strokeWidth="1.8" strokeLinecap="round" />
          <path d="M34 16.5q4-2.5 8 -0.5" fill="none" stroke={STROKE} strokeWidth="1.8" strokeLinecap="round" />
          <ellipse cx="32" cy="34.5" rx="3" ry="3.8" fill={STROKE} />
        </>
      )}
      {tone === "challenging" && (
        <>
          {/* furrowed brows + flat skeptical mouth */}
          <path d="M22 17.5l8 2.5" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
          <path d="M42 17.5l-8 2.5" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
          <path d="M26 35h11" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

function Candidate({ tone }: { tone: InterviewTone }) {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden>
      {/* shirt */}
      <path d="M14 58c1-9 8-13 18-13s17 4 18 13" fill="#9DBFA6" />
      {/* head */}
      <circle cx="32" cy="26" r="15" fill="#F9DFC8" stroke={STROKE} strokeWidth="2" />
      {/* hair */}
      <path d="M17 26c0-10 6-15 15-15 5 0 8 2 8 2s-2 4-8 4c-7 0-10 4-10 11z" fill="#6B4A2B" />
      {/* eyes */}
      <circle cx="26.5" cy="25.5" r="1.9" fill={STROKE} />
      <circle cx="38" cy="25.5" r="1.9" fill={STROKE} />
      {tone === "friendly" && (
        <path d="M25 33q7 6 14 0" fill="none" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
      )}
      {tone === "curious" && (
        <path d="M26 34q6 3.5 12 0" fill="none" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
      )}
      {tone === "challenging" && (
        // composed, confident half-smile — the answer stays calm
        <path d="M27 34.5q5 2.5 10 -0.5" fill="none" stroke={STROKE} strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

export const TONE_META: Record<
  InterviewTone,
  { label: string; chip: string; hint: string }
> = {
  friendly: {
    label: "Friendly opener",
    chip: "#2F6B4F",
    hint: "Warm tone — build rapport, smile back.",
  },
  curious: {
    label: "Digging deeper",
    chip: "#B07D2B",
    hint: "They want specifics — bring numbers.",
  },
  challenging: {
    label: "Pressure test",
    chip: "#B04A3A",
    hint: "Stay calm and concrete — don't get defensive.",
  },
};

/** The two-character interview scene for one question. */
export function InterviewScene({ tone }: { tone: InterviewTone }) {
  return (
    <span className="inline-flex shrink-0 items-end">
      <Interviewer tone={tone} />
      <span className="-ml-1.5">
        <Candidate tone={tone} />
      </span>
    </span>
  );
}

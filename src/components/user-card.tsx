"use client";

import { formatMcqAnswer, FunnelState, isMcqAnswered } from "@/lib/funnel";
import { Badge, Card } from "@/components/ui";

/**
 * The User Card (PRD "כרטיס משתמש"): the candidate's dossier — latest CV
 * extraction plus everything they answered. Guests build it in the funnel
 * (kept in the browser); registered users can save it; paying users feed
 * it into report generation.
 */
export function UserCard({
  state,
  compact = false,
}: {
  state: FunnelState;
  /** hides the Q&A lists — used when a full answer list is shown elsewhere */
  compact?: boolean;
}) {
  const p = state.profile;
  if (!p) return null;

  const mcqAnswered = (state.mcq?.questions ?? []).filter((q) =>
    isMcqAnswered(state.mcqAnswers[q.id])
  );
  const openAnswered = (state.questionnaire?.questions ?? []).filter(
    (q) => (state.answers[q.id] ?? "").trim().length > 0
  );
  const latestRole = p.experience[0];

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-indigo-100 bg-indigo-50/60 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              {p.contact.fullName || "Your profile"}
            </h3>
            {p.headline && (
              <p className="text-sm text-indigo-700">{p.headline}</p>
            )}
          </div>
          <Badge tone="indigo">User Card</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {[p.contact.email, p.contact.location].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 text-center">
        {[
          { n: p.experience.length, label: "roles" },
          { n: p.skills.length, label: "skills" },
          { n: mcqAnswered.length + openAnswered.length, label: "answers" },
        ].map((s) => (
          <div key={s.label} className="px-2 py-3">
            <p className="text-xl font-bold text-slate-900">{s.n}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-4 px-6 py-4">
        {latestRole && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Latest role
            </h4>
            <p className="mt-1 text-sm text-slate-800">
              <span className="font-medium">{latestRole.title}</span>
              {latestRole.company && ` · ${latestRole.company}`}
              {(latestRole.startDate || latestRole.endDate) && (
                <span className="text-slate-400">
                  {" "}
                  ({latestRole.startDate}
                  {" – "}
                  {latestRole.current ? "present" : latestRole.endDate})
                </span>
              )}
            </p>
          </div>
        )}

        {p.skills.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Skills
            </h4>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {p.skills.slice(0, 14).map((s) => (
                <span
                  key={s}
                  className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700"
                >
                  {s}
                </span>
              ))}
              {p.skills.length > 14 && (
                <span className="px-1 text-xs text-slate-400">
                  +{p.skills.length - 14} more
                </span>
              )}
            </div>
          </div>
        )}

        {!compact && mcqAnswered.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              ✓ Verified in your quick check
            </h4>
            <ul className="mt-1.5 space-y-1 text-sm">
              {mcqAnswered.map((q) => (
                <li key={q.id} className="text-slate-600">
                  <span className="text-slate-400">{q.question}</span>{" "}
                  <span className="font-medium text-slate-800">
                    {formatMcqAnswer(state.mcqAnswers[q.id])}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!compact && openAnswered.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Extra details you added
            </h4>
            <ul className="mt-1.5 space-y-1.5 text-sm">
              {openAnswered.map((q) => (
                <li key={q.id} className="text-slate-600">
                  <span className="text-slate-400">{q.question}</span>
                  <br />
                  <span className="text-slate-800">{state.answers[q.id]}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}

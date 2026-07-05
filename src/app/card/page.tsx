"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FunnelState,
  McqAnswer,
  formatMcqAnswer,
  isMcqAnswered,
  loadFunnel,
  saveFunnel,
} from "@/lib/funnel";
import { useSimUser } from "@/lib/sim-user";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import { UserCard } from "@/components/user-card";
import { McqOptions } from "@/components/mcq-options";

/**
 * The User Card dashboard — the central profile hub: identity summary,
 * keyword search across every past answer, the complete answered list with
 * inline editing, and suggested unanswered questions for continuous profile
 * enrichment. (UI/UX phase: everything reads/writes the local funnel state;
 * the ML question-mapping loop is deferred to the backend phase.)
 */
export default function CardPage() {
  const router = useRouter();
  const sim = useSimUser();
  const [state, setState] = useState<FunnelState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    setState(loadFunnel());
    setHydrated(true);
  }, []);

  // Simulated states: "registered — no profile" forces the empty state;
  // "registered/paid with profile" present the card as account-saved.
  const simRegistered =
    sim === "registered_with_profile" || sim === "paid_with_profile";
  const hasCard = Boolean(state?.profile) && sim !== "registered_no_profile";

  /* ------------- edits persist straight to the funnel state ---------- */
  function update(next: FunnelState) {
    setState(next);
    saveFunnel(next);
  }
  function updateMcq(qId: string, a: McqAnswer) {
    if (!state) return;
    update({ ...state, mcqAnswers: { ...state.mcqAnswers, [qId]: a } });
  }
  function updateOpen(qId: string, text: string) {
    if (!state) return;
    update({ ...state, answers: { ...state.answers, [qId]: text } });
  }

  function tailorToJob() {
    if (!state) return;
    // The JD is captured on the upload step now; land there (or straight
    // on results when a job already exists).
    const step = state.jdText?.trim().length >= 100 ? "gate" : "upload";
    saveFunnel({ ...state, step });
    router.push("/");
  }

  /* ------------- search + answered/suggested partitions -------------- */
  const kw = search.trim().toLowerCase();
  const matches = (...parts: (string | undefined)[]) =>
    !kw || parts.some((p) => (p ?? "").toLowerCase().includes(kw));

  const mcqQs = state?.mcq?.questions ?? [];
  const openQs = state?.questionnaire?.questions ?? [];

  const answeredMcq = mcqQs.filter(
    (q) =>
      isMcqAnswered(state!.mcqAnswers[q.id]) &&
      matches(q.question, q.topic, formatMcqAnswer(state!.mcqAnswers[q.id]))
  );
  const answeredOpen = openQs.filter(
    (q) =>
      (state!.answers?.[q.id] ?? "").trim().length > 0 &&
      matches(q.question, state!.answers[q.id])
  );
  const suggestedMcq = mcqQs.filter(
    (q) => !isMcqAnswered(state!.mcqAnswers[q.id]) && matches(q.question, q.topic)
  );
  const suggestedOpen = openQs.filter(
    (q) =>
      (state!.answers?.[q.id] ?? "").trim().length === 0 &&
      matches(q.question)
  );
  const answeredCount = answeredMcq.length + answeredOpen.length;
  const suggestedCount = suggestedMcq.length + suggestedOpen.length;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <nav className="mb-8 flex items-center justify-between">
        <Link
          href="/"
          className="font-display text-[21px] font-extrabold tracking-tight text-ink"
        >
          Spe<span className="text-accent">CV</span>
        </Link>
        <span className="rounded-full bg-green-50 px-3.5 py-1.5 text-[12.5px] font-bold text-accent">
          Free during launch
        </span>
      </nav>

      {hydrated && !hasCard && (
        <Card className="p-10 text-center">
          <span className="text-3xl">🗂️</span>
          <h1 className="mt-3 text-xl font-bold text-slate-900">
            No User Card yet
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
            {sim === "registered_no_profile"
              ? "Your account has no profile yet. Build it in about 3 minutes — your latest CV plus everything you tell us about it."
              : "Your card is your career dossier: your latest CV plus everything you tell us about it. Build it in about 3 minutes — no account needed."}
          </p>
          <Link href="/">
            <Button size="lg" className="mt-5">
              Build my card
            </Button>
          </Link>
        </Card>
      )}

      {hydrated && hasCard && state && (
        <>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">Your User Card</h1>
            {simRegistered && <Badge tone="green">Saved to your account ✓</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {simRegistered
              ? "Saved to your account. This card powers your custom CVs and simulation reports."
              : "Stored in this browser — it powers every CV and report you generate. Clearing site data resets it."}
          </p>

          <div className="mt-5">
            <UserCard state={state} compact />
          </div>

          {/* Keyword search across all past answers */}
          <div className="mt-6">
            <Input
              placeholder="🔍  Search your answers (e.g. SQL, Tableau, team)…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Complete answered list with inline editing */}
          <h2 className="mt-6 text-lg font-semibold text-slate-900">
            Your answers{" "}
            <span className="text-sm font-normal text-slate-400">
              ({answeredCount})
            </span>
          </h2>
          <div className="mt-3 space-y-2">
            {answeredCount === 0 && (
              <Card className="p-4 text-sm text-slate-500">
                {kw ? `No answers match “${search}”.` : "No answers yet."}
              </Card>
            )}
            {answeredMcq.map((q) => (
              <Card key={q.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                      {q.topic || "General"}
                    </span>
                    <p className="mt-1 text-sm text-slate-500">{q.question}</p>
                    {editingId !== q.id && (
                      <p className="mt-0.5 text-sm font-medium text-slate-900">
                        {formatMcqAnswer(state.mcqAnswers[q.id])}
                      </p>
                    )}
                  </div>
                  <button
                    className="shrink-0 cursor-pointer text-xs text-indigo-600 underline"
                    onClick={() =>
                      setEditingId(editingId === q.id ? null : q.id)
                    }
                  >
                    {editingId === q.id ? "Done" : "Edit"}
                  </button>
                </div>
                {editingId === q.id && (
                  <div className="mt-2">
                    <McqOptions
                      question={q}
                      answer={state.mcqAnswers[q.id]}
                      onChange={(next) => updateMcq(q.id, next)}
                    />
                  </div>
                )}
              </Card>
            ))}
            {answeredOpen.map((q) => (
              <Card key={q.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-slate-500">{q.question}</p>
                    {editingId !== q.id && (
                      <p className="mt-0.5 text-sm font-medium text-slate-900">
                        {state.answers[q.id]}
                      </p>
                    )}
                  </div>
                  <button
                    className="shrink-0 cursor-pointer text-xs text-indigo-600 underline"
                    onClick={() =>
                      setEditingId(editingId === q.id ? null : q.id)
                    }
                  >
                    {editingId === q.id ? "Done" : "Edit"}
                  </button>
                </div>
                {editingId === q.id && (
                  <Textarea
                    rows={2}
                    className="mt-2"
                    value={state.answers[q.id] ?? ""}
                    onChange={(e) => updateOpen(q.id, e.target.value)}
                  />
                )}
              </Card>
            ))}
          </div>

          {/* Suggested unanswered questions — continuous enrichment */}
          {suggestedCount > 0 && (
            <>
              <h2 className="mt-8 text-lg font-semibold text-slate-900">
                Suggested for you{" "}
                <span className="text-sm font-normal text-slate-400">
                  ({suggestedCount} unanswered)
                </span>
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Answering these enriches your profile and sharpens every CV we
                generate for you.
              </p>
              <div className="mt-3 space-y-2">
                {suggestedMcq.map((q) => (
                  <Card
                    key={q.id}
                    className="border-dashed bg-indigo-50/30 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-block rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-600">
                          {q.topic || "General"}
                        </span>
                        <p className="mt-1 text-sm text-slate-700">
                          {q.question}
                        </p>
                      </div>
                      {editingId !== q.id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditingId(q.id)}
                        >
                          Answer
                        </Button>
                      )}
                    </div>
                    {editingId === q.id && (
                      <div className="mt-2">
                        <McqOptions
                          question={q}
                          answer={state.mcqAnswers[q.id]}
                          onChange={(next) => updateMcq(q.id, next)}
                        />
                      </div>
                    )}
                  </Card>
                ))}
                {suggestedOpen.map((q) => (
                  <Card
                    key={q.id}
                    className="border-dashed bg-indigo-50/30 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 text-sm text-slate-700">
                        {q.question}
                      </p>
                      {editingId !== q.id && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setEditingId(q.id)}
                        >
                          Answer
                        </Button>
                      )}
                    </div>
                    {editingId === q.id && (
                      <Textarea
                        rows={2}
                        className="mt-2"
                        placeholder="Your answer — any language works…"
                        value={state.answers[q.id] ?? ""}
                        onChange={(e) => updateOpen(q.id, e.target.value)}
                      />
                    )}
                  </Card>
                ))}
              </div>
            </>
          )}

          <div className="mt-8 flex flex-wrap justify-end gap-2">
            <Button onClick={tailorToJob}>Tailor my CV to a job →</Button>
          </div>
        </>
      )}
    </main>
  );
}

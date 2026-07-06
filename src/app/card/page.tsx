"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  FunnelState,
  McqAnswer,
  OTHER_OPTION,
  isMcqAnswered,
  loadFunnel,
  saveFunnel,
} from "@/lib/funnel";
import { McqQuestionnaire, Questionnaire } from "@/lib/types";
import { useSimUser } from "@/lib/sim-user";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import { UserCard } from "@/components/user-card";
import { McqOptions } from "@/components/mcq-options";
import { Navbar } from "@/components/navbar";

type McqQuestion = McqQuestionnaire["questions"][number];
type OpenQuestion = Questionnaire["questions"][number];

/** Every selected option as its own display string (multi-select safe). */
function mcqAnswerParts(a?: McqAnswer): string[] {
  return (a?.selected ?? [])
    .map((o) =>
      o === OTHER_OPTION
        ? (a?.other ?? "").trim()
          ? `Other: ${(a?.other ?? "").trim()}`
          : ""
        : o
    )
    .filter(Boolean);
}

/** All selected answers, each as a chip — ranked picks keep their number. */
function AnswerChips({ answer }: { answer?: McqAnswer }) {
  const parts = mcqAnswerParts(answer);
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {parts.map((p, i) => (
        <span
          key={p}
          className="rounded-full bg-selected-bg px-2.5 py-0.5 text-[12.5px] font-semibold text-accent-deep"
        >
          {parts.length > 1 ? `${i + 1}) ` : ""}
          {p}
        </span>
      ))}
    </div>
  );
}

/** A visible chevron so users always have a clear way to collapse a row. */
function CollapseArrow({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label="Collapse this question"
      title="Collapse"
      className="shrink-0 cursor-pointer rounded-full px-2 py-0.5 text-sm font-bold text-ink-faint transition-colors hover:bg-chip hover:text-ink"
    >
      ▲
    </button>
  );
}

/** Collapsible section (accordion) — "Answered" / "Unanswered". */
function Section({
  title,
  count,
  hint,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  hint: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="overflow-hidden">
      <button
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-5 py-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <span className="text-[16px] font-bold text-ink">
            {title}{" "}
            <span className="text-sm font-normal text-ink-faint">({count})</span>
          </span>
          <p className="text-[12.5px] text-ink-faint">{hint}</p>
        </div>
        <span className="text-sm text-ink-faint">{open ? "▲" : "▼"}</span>
      </button>
      {open && <div className="border-t border-border">{children}</div>}
    </Card>
  );
}

/**
 * The User Card dashboard — the central profile hub: identity summary,
 * keyword search across every question, and two accordions (Answered /
 * Unanswered) whose collapsed rows show a faded snippet of the question.
 * Expanding a row shows the full Q&A; edits are held as a local draft and
 * only saved on "Done" (which also collapses the row and opens the next
 * one) or the collapse arrow. Everything reads/writes the local funnel
 * state.
 */
export default function CardPage() {
  const sim = useSimUser();
  const [state, setState] = useState<FunnelState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Draft answers for the open row. Edits stay local while the row is open
  // (so typing/selecting never re-partitions the list and collapses the row);
  // they're committed to the funnel only when the user clicks "Done".
  const [draftMcq, setDraftMcq] = useState<McqAnswer | null>(null);
  const [draftText, setDraftText] = useState("");

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

  /* ------------- search + answered/unanswered partitions ------------- */
  const kw = search.trim().toLowerCase();
  const matches = (...parts: (string | undefined)[]) =>
    !kw || parts.some((p) => (p ?? "").toLowerCase().includes(kw));

  const mcqQs = state?.mcq?.questions ?? [];
  const openQs = state?.questionnaire?.questions ?? [];

  const answeredMcq = mcqQs.filter(
    (q) =>
      isMcqAnswered(state!.mcqAnswers[q.id]) &&
      matches(q.question, q.topic, ...mcqAnswerParts(state!.mcqAnswers[q.id]))
  );
  const answeredOpen = openQs.filter(
    (q) =>
      (state!.answers?.[q.id] ?? "").trim().length > 0 &&
      matches(q.question, state!.answers[q.id])
  );
  const unansweredMcq = mcqQs.filter(
    (q) => !isMcqAnswered(state!.mcqAnswers[q.id]) && matches(q.question, q.topic)
  );
  const unansweredOpen = openQs.filter(
    (q) =>
      (state!.answers?.[q.id] ?? "").trim().length === 0 && matches(q.question)
  );
  const answeredCount = answeredMcq.length + answeredOpen.length;
  const unansweredCount = unansweredMcq.length + unansweredOpen.length;

  /* ------------- open ⇄ commit ⇄ advance (draft-based editing) -------- */
  const isMcqId = (qId: string) => mcqQs.some((q) => q.id === qId);

  /** Open a row for editing, seeding the draft from its saved answer. */
  function beginEdit(qId: string) {
    if (!state) return;
    setExpandedId(qId);
    if (isMcqId(qId)) {
      setDraftMcq(state.mcqAnswers[qId] ?? { selected: [] });
      setDraftText("");
    } else {
      setDraftText(state.answers[qId] ?? "");
      setDraftMcq(null);
    }
  }

  /** Persist the draft of a given row to the funnel state. */
  function commitEdit(qId: string) {
    if (!state) return;
    if (isMcqId(qId)) {
      if (draftMcq) updateMcq(qId, draftMcq);
    } else {
      updateOpen(qId, draftText);
    }
  }

  /** Clicking another collapsed row saves the currently-open one first. */
  function expandRow(qId: string) {
    if (expandedId && expandedId !== qId) commitEdit(expandedId);
    beginEdit(qId);
  }

  /** The collapse arrow: save and close, staying put (no advance). */
  function closeRow() {
    if (expandedId) commitEdit(expandedId);
    setExpandedId(null);
  }

  /** "Done": save this answer, close the row, and open the next question
   *  in the order they're shown on screen (so the flow reads top-to-bottom). */
  function doneRow(qId: string) {
    commitEdit(qId);
    const shown = [
      ...answeredMcq,
      ...answeredOpen,
      ...unansweredMcq,
      ...unansweredOpen,
    ].map((q) => q.id);
    const nextId = shown[shown.indexOf(qId) + 1];
    if (nextId) beginEdit(nextId);
    else setExpandedId(null);
  }

  /* ------------- one row = one question (collapsed ⇄ expanded) -------
     Render functions (not components): a new component type per render
     would remount the row and drop textarea focus on every keystroke. */
  function mcqRow(q: McqQuestion, answered: boolean) {
    const expanded = expandedId === q.id;
    return (
      <div key={q.id} className="border-b border-border last:border-b-0">
        {!expanded ? (
          <button
            className="flex w-full cursor-pointer items-center gap-2 px-5 py-3 text-left"
            onClick={() => expandRow(q.id)}
          >
            <span className="shrink-0 rounded bg-chip px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
              {q.topic || "General"}
            </span>
            {/* faded, light-gray preview snippet of the question */}
            <span className="min-w-0 truncate text-sm text-muted">
              {q.question}
            </span>
            {answered && (
              <span className="ml-auto shrink-0 text-xs font-bold text-accent">
                ✓
              </span>
            )}
          </button>
        ) : (
          <div className="px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-block rounded bg-chip px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                {q.topic || "General"}
              </span>
              <CollapseArrow onClick={closeRow} />
            </div>
            <p className="mt-1.5 text-[15px] font-semibold text-ink">
              {q.question}
            </p>
            {(draftMcq?.selected.length ?? 0) > 0 && (
              <div className="mt-2">
                <AnswerChips answer={draftMcq ?? undefined} />
              </div>
            )}
            <div className="mt-3">
              <McqOptions
                question={q}
                answer={draftMcq ?? { selected: [] }}
                onChange={(next) => setDraftMcq(next)}
              />
            </div>
            <div className="mt-3 text-right">
              <Button size="sm" onClick={() => doneRow(q.id)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function openRow(q: OpenQuestion, answered: boolean) {
    const expanded = expandedId === q.id;
    return (
      <div key={q.id} className="border-b border-border last:border-b-0">
        {!expanded ? (
          <button
            className="flex w-full cursor-pointer items-center gap-2 px-5 py-3 text-left"
            onClick={() => expandRow(q.id)}
          >
            <span className="min-w-0 truncate text-sm text-muted">
              {q.question}
            </span>
            {answered && (
              <span className="ml-auto shrink-0 text-xs font-bold text-accent">
                ✓
              </span>
            )}
          </button>
        ) : (
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[15px] font-semibold text-ink">{q.question}</p>
              <CollapseArrow onClick={closeRow} />
            </div>
            {q.why && <p className="mt-0.5 text-[12.5px] text-ink-faint">{q.why}</p>}
            <Textarea
              rows={2}
              className="mt-2.5"
              placeholder="Your answer — any language works…"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
            />
            <div className="mt-3 text-right">
              <Button size="sm" onClick={() => doneRow(q.id)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-4">
        {hydrated && !hasCard && (
          <Card className="p-10 text-center">
            <span className="text-3xl">🗂️</span>
            <h1 className="mt-3 text-xl font-bold text-ink">
              No User Card yet
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
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
              <h1 className="text-2xl font-bold text-ink">Your User Card</h1>
              {simRegistered && <Badge tone="green">Saved to your account ✓</Badge>}
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {simRegistered
                ? "Saved to your account. This card powers your custom CVs and simulation reports."
                : "Stored in this browser — it powers every CV and report you generate. Clearing site data resets it."}
            </p>

            <div className="mt-5">
              <UserCard state={state} compact />
            </div>

            {/* Keyword search across every question and answer */}
            <div className="mt-6">
              <Input
                placeholder="🔍  Search your answers (e.g. SQL, Tableau, team)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="mt-6 space-y-4">
              <Section
                title="Your answers"
                count={answeredCount}
                hint="Everything you've confirmed — click a row to review or edit."
                defaultOpen
              >
                {answeredCount === 0 && (
                  <p className="px-5 py-4 text-sm text-ink-faint">
                    {kw ? `No answers match “${search}”.` : "No answers yet."}
                  </p>
                )}
                {answeredMcq.map((q) => mcqRow(q, true))}
                {answeredOpen.map((q) => openRow(q, true))}
              </Section>

              <Section
                title="Suggested for you"
                count={unansweredCount}
                hint="Unanswered questions — each one you answer enriches your profile and sharpens every CV we generate."
                defaultOpen
              >
                {unansweredCount === 0 && (
                  <p className="px-5 py-4 text-sm text-ink-faint">
                    {kw
                      ? `No open questions match “${search}”.`
                      : "Nothing left — you answered everything 🎉"}
                  </p>
                )}
                {unansweredMcq.map((q) => mcqRow(q, false))}
                {unansweredOpen.map((q) => openRow(q, false))}
              </Section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

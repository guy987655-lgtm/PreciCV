"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FunnelState,
  McqAnswer,
  OTHER_OPTION,
  clearAllAnswers,
  flowDisplayName,
  formatMcqAnswer,
  isMcqAnswered,
  loadFunnel,
  loadHistory,
  saveFunnel,
  stampAnswerTime,
  updateHistoryEntry,
} from "@/lib/funnel";
import { MonthBucket, cumulativeUniqueAnswered } from "@/lib/answer-stats";
import { readJson } from "@/lib/fetch-json";
import { trackButtonClick } from "@/lib/analytics";
import { McqQuestionnaire, Questionnaire } from "@/lib/types";
import { isSimilarQuestion } from "@/lib/text";
import { buildTopicBuckets, matchesTopic, resolveTopic } from "@/lib/topics";
import { AnswersChart } from "@/components/answers-chart";
import { useSimUser } from "@/lib/sim-user";
import { useSession } from "@/lib/use-session";
import { Badge, Button, Card, Input, Textarea, Toast } from "@/components/ui";
import { ConfirmCountdownModal } from "@/components/confirm-countdown-modal";
import { LoadingAnnounce, Skeleton, SkeletonRows } from "@/components/skeleton";
import { TopicFilter } from "@/components/topic-filter";
import { UserCard } from "@/components/user-card";
import { McqOptions } from "@/components/mcq-options";
import { Navbar } from "@/components/navbar";

type McqQuestion = McqQuestionnaire["questions"][number];
type OpenQuestion = Questionnaire["questions"][number];

/** An answer as the account remembers it (GET /api/answers). */
type ServerAnswer = {
  question: string;
  answer: string;
  kind: "mcq" | "open";
  selected?: string[];
  other?: string;
  options?: string[];
  selectType?: "single" | "ranked";
  /** "" on rows stored before topics were persisted — inferred on display. */
  topic?: string;
  updatedAt?: number;
};

/**
 * Where a card row's answer lives — it decides where an edit is written back.
 * The card used to read only the ACTIVE flow, so every question from an
 * earlier application was invisible and uneditable; rows now come from all
 * three stores and each remembers its own home.
 */
type RowSource =
  | { type: "active" }
  | { type: "history"; flowId: string; label: string }
  | { type: "account" };

type CardRow = {
  /** Unique across sources — the same question can exist in several flows. */
  key: string;
  source: RowSource;
  answeredAt: number;
} & (
  | { kind: "mcq"; q: McqQuestion; answer: McqAnswer | undefined }
  | { kind: "open"; q: OpenQuestion; text: string }
);

/** Human label for where a row came from, shown next to older answers. */
function sourceLabel(source: RowSource): string {
  if (source.type === "history") return source.label;
  if (source.type === "account") return "Saved to your account";
  return "";
}

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
  const { signedIn, loading: sessionLoading } = useSession();
  const [state, setState] = useState<FunnelState | null>(null);
  const [historyFlows, setHistoryFlows] = useState<FunnelState[]>([]);
  const [serverAnswers, setServerAnswers] = useState<ServerAnswer[]>([]);
  const [hydrated, setHydrated] = useState(false);
  // Distinct from `serverAnswers.length === 0`, which cannot tell an empty
  // account from an unfinished fetch — that ambiguity is what flashed the
  // "No User Card yet" empty state at users who do have a card.
  const [answersLoading, setAnswersLoading] = useState(true);
  const [search, setSearch] = useState("");
  /** "" = All. Category chips under the search box. */
  const [activeTopic, setActiveTopic] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // "Clear my data" — confirmation, in-flight state, and the success toast.
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState("");
  const [cleared, setCleared] = useState(false);
  // Draft answers for the open row. Edits stay local while the row is open
  // (so typing/selecting never re-partitions the list and collapses the row);
  // they're committed to the funnel only when the user clicks "Done".
  const [draftMcq, setDraftMcq] = useState<McqAnswer | null>(null);
  const [draftText, setDraftText] = useState("");

  // Progress chart data — unique questions answered across the active flow
  // and every archived one (PRD v2 Topic 10). Seeded on hydrate, refreshed
  // by update() after each edit.
  const [chartData, setChartData] = useState<MonthBucket[]>([]);
  const computeChart = (s: FunnelState | null) =>
    cumulativeUniqueAnswered([...(s ? [s] : []), ...loadHistory()]);

  useEffect(() => {
    const s = loadFunnel();
    setState(s);
    setHistoryFlows(loadHistory());
    setChartData(computeChart(s));
    setHydrated(true);
  }, []);

  // The account's answer memory — the only source that survives a new device
  // or cleared storage, and the one progressive profiling matches against.
  useEffect(() => {
    if (!signedIn) {
      setServerAnswers([]);
      setAnswersLoading(false);
      return;
    }
    let alive = true;
    setAnswersLoading(true);
    fetch("/api/answers")
      .then((r) => (r.ok ? r.json() : { answers: [] }))
      .then((d) => alive && setServerAnswers(d.answers ?? []))
      .catch(() => alive && setServerAnswers([]))
      .finally(() => alive && setAnswersLoading(false));
    return () => {
      alive = false;
    };
  }, [signedIn]);

  // A REAL session always counts as registered; `simMeta` is the dev-only
  // simulator and reports "guest" in production, which is what used to show
  // a signed-in user the "No User Card yet" empty state.
  const simRegistered =
    signedIn || sim === "registered_with_profile" || sim === "paid_with_profile";
  const hasCard =
    (Boolean(state?.profile) || historyFlows.length > 0 || serverAnswers.length > 0) &&
    (signedIn || sim !== "registered_no_profile");

  /**
   * Wipes the answer memory: the account rows first (the source that survives
   * devices and cleared storage), then every flow in this browser. The account
   * call goes first on purpose — if it fails there is still something to
   * delete, and reporting success while the account copy survived would be a
   * lie the user could only discover on their next application.
   */
  async function clearAnswers() {
    setClearing(true);
    setClearError("");
    trackButtonClick({
      button_name: "clear_my_answers",
      action: "delete",
      button_text: "Delete my answers",
      click_source: "card_page",
    });
    try {
      if (signedIn) {
        const res = await fetch("/api/answers", { method: "DELETE" });
        if (!res.ok) {
          const data = await readJson(res);
          throw new Error(data.error ?? "Could not clear your answers");
        }
      }
      clearAllAnswers();
      const s = loadFunnel();
      setServerAnswers([]);
      setState(s);
      setHistoryFlows(loadHistory());
      setChartData(computeChart(s));
      setExpandedId(null);
      setClearOpen(false);
      setCleared(true);
      setTimeout(() => setCleared(false), 4000);
    } catch (e) {
      setClearError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setClearing(false);
    }
  }

  /* ------------- edits persist straight to the funnel state ---------- */
  function update(next: FunnelState) {
    setState(next);
    saveFunnel(next);
    setChartData(computeChart(next));
  }
  function updateMcq(qId: string, a: McqAnswer) {
    if (!state) return;
    update({
      ...state,
      mcqAnswers: { ...state.mcqAnswers, [qId]: a },
      answerTimes: stampAnswerTime(state, qId, isMcqAnswered(a)),
    });
  }
  function updateOpen(qId: string, text: string) {
    if (!state) return;
    update({
      ...state,
      answers: { ...state.answers, [qId]: text },
      answerTimes: stampAnswerTime(state, qId, text.trim().length > 0),
    });
  }

  /* ------------- every question this user has ever been asked --------
     The card is the profile hub, so it must show the whole history: the
     active flow, every archived flow on this device, and the account's
     answer memory. Same question asked twice → one row, newest answer. */
  const rows = useMemo<CardRow[]>(() => {
    const out: CardRow[] = [];
    const flows: { flow: FunnelState; source: RowSource }[] = [
      ...(state?.profile ? [{ flow: state, source: { type: "active" as const } }] : []),
      ...historyFlows
        .filter((f) => f.flowId !== state?.flowId)
        .map((f) => ({
          flow: f,
          source: {
            type: "history" as const,
            flowId: f.flowId,
            label: flowDisplayName(f),
          },
        })),
    ];

    for (const { flow, source } of flows) {
      for (const q of flow.mcq?.questions ?? []) {
        out.push({
          key: `${source.type}:${"flowId" in source ? source.flowId : ""}:mcq:${q.id}`,
          source,
          kind: "mcq",
          q,
          answer: flow.mcqAnswers[q.id],
          answeredAt: flow.answerTimes?.[q.id] ?? flow.savedAt ?? 0,
        });
      }
      for (const q of flow.questionnaire?.questions ?? []) {
        out.push({
          key: `${source.type}:${"flowId" in source ? source.flowId : ""}:open:${q.id}`,
          source,
          kind: "open",
          q,
          text: flow.answers[q.id] ?? "",
          answeredAt: flow.answerTimes?.[q.id] ?? flow.savedAt ?? 0,
        });
      }
    }

    // Account answers become rows too — on a fresh device they are the ONLY
    // source, which is exactly the case the old card page couldn't show.
    serverAnswers.forEach((a, i) => {
      if (a.kind === "mcq") {
        out.push({
          key: `account::mcq:${i}`,
          source: { type: "account" },
          kind: "mcq",
          q: {
            id: `srv_${i}`,
            topic: a.topic ?? "",
            question: a.question,
            options: a.options ?? [],
            selectType: a.selectType ?? "single",
            required: false,
            placeholderText: "",
          },
          answer: { selected: a.selected ?? [], other: a.other },
          answeredAt: a.updatedAt ?? 0,
        });
      } else {
        out.push({
          key: `account::open:${i}`,
          source: { type: "account" },
          kind: "open",
          q: { id: `srv_${i}`, question: a.question, why: "", topic: a.topic ?? "" },
          text: a.answer,
          answeredAt: a.updatedAt ?? 0,
        });
      }
    });

    // De-duplicate semantically (the LLM rewords every flow), newest first so
    // the surviving row is the most recent answer to that question.
    const answered = (r: CardRow) =>
      r.kind === "mcq" ? isMcqAnswered(r.answer) : r.text.trim().length > 0;
    const sorted = [...out].sort((a, b) => {
      if (answered(a) !== answered(b)) return answered(a) ? -1 : 1;
      return b.answeredAt - a.answeredAt;
    });
    const kept: CardRow[] = [];
    for (const row of sorted) {
      if (
        kept.some(
          (k) => k.kind === row.kind && isSimilarQuestion(k.q.question, row.q.question)
        )
      ) {
        continue;
      }
      kept.push(row);
    }
    return kept;
  }, [state, historyFlows, serverAnswers]);

  /* ------------- category + search + answered/unanswered partitions --
     Topics come from the question when it has one and from a keyword pass
     otherwise, so rows predating the topic field still land in a real
     bucket instead of all piling into "General". */
  const rowTopic = useCallback(
    (r: CardRow) => resolveTopic(r.q.topic, r.q.question),
    []
  );

  // Buckets are derived from ALL rows, not the filtered ones, so the counts
  // on the chips don't collapse the moment you pick one.
  const topicBuckets = useMemo(
    () => buildTopicBuckets(rows.map(rowTopic)),
    [rows, rowTopic]
  );

  const kw = search.trim().toLowerCase();
  const matches = (...parts: (string | undefined)[]) =>
    !kw || parts.some((p) => (p ?? "").toLowerCase().includes(kw));

  const rowAnswered = (r: CardRow) =>
    r.kind === "mcq" ? isMcqAnswered(r.answer) : r.text.trim().length > 0;
  const rowMatches = (r: CardRow) => {
    if (!matchesTopic(rowTopic(r), activeTopic, topicBuckets)) return false;
    return r.kind === "mcq"
      ? matches(r.q.question, rowTopic(r), ...mcqAnswerParts(r.answer))
      : matches(r.q.question, rowTopic(r), r.text);
  };

  const answeredRows = rows.filter((r) => rowAnswered(r) && rowMatches(r));
  const unansweredRows = rows.filter((r) => !rowAnswered(r) && rowMatches(r));
  const answeredCount = answeredRows.length;
  const unansweredCount = unansweredRows.length;

  /* ------------- open ⇄ commit ⇄ advance (draft-based editing) -------- */

  /**
   * Mirrors an edit into the account's answer memory, which is what future
   * jobs are matched against — otherwise correcting an answer here would
   * leave the old one to be replayed onto the next application.
   */
  const syncToAccount = useCallback(
    (row: CardRow, answer: string, mcq?: McqAnswer) => {
      if (!signedIn || !answer.trim()) return;
      void fetch("/api/answers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: [
            {
              question: row.q.question,
              answer,
              kind: row.kind,
              // Sent for both kinds so the category survives to a new device.
              topic: resolveTopic(row.q.topic, row.q.question),
              ...(row.kind === "mcq"
                ? {
                    selected: mcq?.selected ?? [],
                    other: mcq?.other,
                    options: row.q.options,
                    selectType: row.q.selectType,
                  }
                : {}),
            },
          ],
        }),
      }).catch(() => {
        /* best-effort: the local edit already landed */
      });
    },
    [signedIn]
  );

  /** Writes an edited row back to whichever store it came from. */
  function persistRow(row: CardRow, mcq: McqAnswer | null, text: string) {
    if (row.kind === "mcq" && mcq) {
      syncToAccount(row, formatMcqAnswer(mcq), mcq);
      if (row.source.type === "active") updateMcq(row.q.id, mcq);
      else if (row.source.type === "history") {
        updateArchivedFlow(row.source.flowId, (f) => ({
          mcqAnswers: { ...f.mcqAnswers, [row.q.id]: mcq },
          answerTimes: stampAnswerTime(f, row.q.id, isMcqAnswered(mcq)),
        }));
      } else {
        // Account-only row: the server call above is the whole write.
        setServerAnswers((as) =>
          as.map((a) =>
            a.question === row.q.question
              ? {
                  ...a,
                  answer: formatMcqAnswer(mcq),
                  selected: mcq.selected,
                  other: mcq.other,
                }
              : a
          )
        );
      }
      return;
    }
    if (row.kind === "open") {
      syncToAccount(row, text);
      if (row.source.type === "active") updateOpen(row.q.id, text);
      else if (row.source.type === "history") {
        updateArchivedFlow(row.source.flowId, (f) => ({
          answers: { ...f.answers, [row.q.id]: text },
          answerTimes: stampAnswerTime(f, row.q.id, text.trim().length > 0),
        }));
      } else {
        setServerAnswers((as) =>
          as.map((a) => (a.question === row.q.question ? { ...a, answer: text } : a))
        );
      }
    }
  }

  /** Patches an archived flow in localStorage and refreshes the local copy. */
  function updateArchivedFlow(
    flowId: string,
    patch: (flow: FunnelState) => Partial<FunnelState>
  ) {
    const flow = loadHistory().find((f) => f.flowId === flowId);
    if (!flow) return;
    const next = patch(flow);
    updateHistoryEntry(flowId, next);
    const flows = loadHistory();
    setHistoryFlows(flows);
    setChartData(cumulativeUniqueAnswered([...(state ? [state] : []), ...flows]));
  }

  const rowByKey = (key: string) => rows.find((r) => r.key === key);

  /** Open a row for editing, seeding the draft from its saved answer. */
  function beginEdit(key: string) {
    const row = rowByKey(key);
    if (!row) return;
    setExpandedId(key);
    if (row.kind === "mcq") {
      setDraftMcq(row.answer ?? { selected: [] });
      setDraftText("");
    } else {
      setDraftText(row.text);
      setDraftMcq(null);
    }
  }

  /** Persist the draft of a given row to its source store. */
  function commitEdit(key: string) {
    const row = rowByKey(key);
    if (!row) return;
    persistRow(row, draftMcq, draftText);
  }

  /** Clicking another collapsed row saves the currently-open one first. */
  function expandRow(key: string) {
    if (expandedId && expandedId !== key) commitEdit(expandedId);
    beginEdit(key);
  }

  /** The collapse arrow: save and close, staying put (no advance). */
  function closeRow() {
    if (expandedId) commitEdit(expandedId);
    setExpandedId(null);
  }

  /** "Done": save this answer, close the row, and open the next question
   *  in the order they're shown on screen (so the flow reads top-to-bottom). */
  function doneRow(key: string) {
    commitEdit(key);
    const shown = [...answeredRows, ...unansweredRows].map((r) => r.key);
    const nextKey = shown[shown.indexOf(key) + 1];
    if (nextKey) beginEdit(nextKey);
    else setExpandedId(null);
  }

  /* ------------- one row = one question (collapsed ⇄ expanded) -------
     Render functions (not components): a new component type per render
     would remount the row and drop textarea focus on every keystroke. */
  function cardRow(row: CardRow) {
    const expanded = expandedId === row.key;
    const answered = rowAnswered(row);
    const origin = sourceLabel(row.source);
    const q = row.q;
    // Both kinds get a chip now — it is the same value the filter groups by,
    // so a row always shows which bucket it lives in.
    const topic = rowTopic(row);
    return (
      <div key={row.key} className="border-b border-border last:border-b-0">
        {!expanded ? (
          <button
            className="flex w-full cursor-pointer items-center gap-2 px-5 py-3 text-left"
            onClick={() => expandRow(row.key)}
          >
            {topic && (
              <span className="shrink-0 rounded bg-chip px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                {topic}
              </span>
            )}
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
              <div className="flex flex-wrap items-center gap-1.5">
                {topic && (
                  <span className="inline-block rounded bg-chip px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                    {topic}
                  </span>
                )}
                {origin && (
                  <span
                    className="inline-block max-w-[220px] truncate rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700"
                    title={`Answered in: ${origin}`}
                  >
                    {origin}
                  </span>
                )}
              </div>
              <CollapseArrow onClick={closeRow} />
            </div>
            <p className="mt-1.5 text-[15px] font-semibold text-ink">
              {q.question}
            </p>
            {row.kind === "open" && row.q.why && (
              <p className="mt-0.5 text-[12.5px] text-ink-faint">{row.q.why}</p>
            )}
            {row.kind === "mcq" ? (
              <>
                {(draftMcq?.selected.length ?? 0) > 0 && (
                  <div className="mt-2">
                    <AnswerChips answer={draftMcq ?? undefined} />
                  </div>
                )}
                <div className="mt-3">
                  <McqOptions
                    question={row.q}
                    answer={draftMcq ?? { selected: [] }}
                    onChange={(next) => setDraftMcq(next)}
                  />
                </div>
              </>
            ) : (
              <Textarea
                rows={2}
                className="mt-2.5"
                placeholder="Your answer — any language works…"
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
              />
            )}
            <div className="mt-3 text-right">
              <Button size="sm" onClick={() => doneRow(row.key)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* Nothing about the card is knowable until localStorage is read AND — for
     a signed-in user — /api/answers has answered, since the account is the
     only source on a fresh device. */
  const loading = !hydrated || sessionLoading || (signedIn && answersLoading);

  return (
    <main className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-4">
        {loading && (
          <>
            <LoadingAnnounce label="Loading your User Card…" />
            <Skeleton className="h-7 w-56" />
            <Skeleton className="mt-2 h-3.5 w-full max-w-md" />
            <Card className="mt-5 flex items-center gap-4 p-5">
              <Skeleton className="h-14 w-14 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-2 h-3 w-28" />
              </div>
            </Card>
            <Card className="mt-6 p-5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-3 h-28 w-full" />
            </Card>
            <Skeleton className="mt-6 h-11 w-full rounded-[14px]" />
            <div className="mt-4 flex gap-2">
              {["3.5rem", "5rem", "6rem", "4.5rem"].map((w) => (
                <Skeleton key={w} className="h-8 rounded-full" style={{ width: w }} />
              ))}
            </div>
            <Card className="mt-6 overflow-hidden p-0">
              <SkeletonRows
                className="space-y-0"
                count={5}
                render={() => (
                  <div className="flex items-center gap-2 border-b border-border px-5 py-3.5 last:border-b-0">
                    <Skeleton className="h-4 w-16 rounded" />
                    <Skeleton className="h-3.5 flex-1" />
                  </div>
                )}
              />
            </Card>
          </>
        )}

        {!loading && !hasCard && (
          <Card className="p-10 text-center">
            <span className="text-3xl">🗂️</span>
            <h1 className="mt-3 text-xl font-bold text-ink">
              No User Card yet
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
              {sim === "registered_no_profile"
                ? "Your account has no profile yet. Build it in about 3 minutes — your latest CV plus everything you tell us about it."
                : "Your card is your career dossier: your latest CV plus everything you tell us about it. Build it in about 3 minutes."}
            </p>
            <Link href="/">
              <Button size="lg" className="mt-5">
                Build my card
              </Button>
            </Link>
          </Card>
        )}

        {/* The card no longer requires an ACTIVE flow: a returning user on a
            new device has answers in their account and archived flows on this
            one, and both must be manageable here. */}
        {!loading && hasCard && (
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

            {state?.profile && (
              <div className="mt-5">
                <UserCard
                  state={state}
                  compact
                  answerCount={rows.filter(rowAnswered).length}
                />
              </div>
            )}

            {/* Progress chart — unique questions answered, cumulative/month */}
            {chartData.length > 0 && (
              <Card className="mt-6 p-5">
                <h2 className="text-[16px] font-bold text-ink">
                  Your progress
                </h2>
                <p className="text-[12.5px] text-ink-faint">
                  Unique questions answered over time — every answer enriches
                  your profile and sharpens future CVs.
                </p>
                <div className="mt-3">
                  <AnswersChart data={chartData} />
                </div>
              </Card>
            )}

            {/* Keyword search across every question and answer */}
            <div className="mt-6">
              <Input
                placeholder="🔍  Search your answers (e.g. SQL, Tableau, team)…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Category chips — jump straight to the questions you want to
                change instead of scanning one long undifferentiated list.
                Composes with the search box above. */}
            <div className="mt-3">
              <TopicFilter
                buckets={topicBuckets}
                active={activeTopic}
                onChange={setActiveTopic}
                total={rows.length}
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
                    {kw
                      ? `No answers match “${search}”.`
                      : activeTopic
                        ? `No answers in “${activeTopic}” yet.`
                        : "No answers yet."}
                  </p>
                )}
                {answeredRows.map((r) => cardRow(r))}
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
                      : activeTopic
                        ? `Nothing open in “${activeTopic}” — all answered 🎉`
                        : "Nothing left — you answered everything 🎉"}
                  </p>
                )}
                {unansweredRows.map((r) => cardRow(r))}
              </Section>
            </div>

            {/* Data control. Deliberately scoped to answers: the card IS the
                answer memory, while CVs, reports and History live elsewhere
                and stay. Full account deletion remains on /my-account. */}
            <Card className="mt-8 border-red-200 p-6">
              <h2 className="font-semibold text-red-700">Clear my data</h2>
              <p className="mt-2 text-sm text-ink-soft">
                Deletes every answer you&apos;ve given. Future CVs are tailored
                without that context, and the next questionnaire starts from
                scratch. Your CVs, reports and history stay.
              </p>
              <Button
                variant="danger"
                className="mt-4"
                onClick={() => setClearOpen(true)}
              >
                Clear my answers
              </Button>
              {clearError && (
                <p className="mt-3 text-sm text-red-600">{clearError}</p>
              )}
            </Card>
          </>
        )}
      </div>

      <ConfirmCountdownModal
        open={clearOpen}
        onClose={() => setClearOpen(false)}
        title="Delete every answer?"
        confirmLabel="Delete my answers"
        cancelLabel="Keep my answers"
        busy={clearing}
        onConfirm={clearAnswers}
      >
        <p>
          Every answer you&apos;ve given{signedIn ? ", on this device and on your account," : ""}{" "}
          will be permanently erased. Future CVs will be tailored without that
          context — the next questionnaire starts from scratch.
        </p>
        <p className="mt-2">
          Your generated CVs, reports and history are not affected.
        </p>
      </ConfirmCountdownModal>

      {cleared && <Toast message="Your answers were deleted." />}
    </main>
  );
}

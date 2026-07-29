"use client";

import {
  Fragment,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { readJson } from "@/lib/fetch-json";
import {
  FunnelState,
  McqAnswer,
  OTHER_OPTION,
  formatMcqAnswer,
} from "@/lib/funnel";
import {
  SeqItem,
  buildSequence,
  isPassed,
  itemStatus,
  questionView,
} from "@/lib/chat-seq";
import { MAX_ASKED_MCQ, MAX_ASKED_OPEN } from "@/lib/types";
import { Button, Modal, Spinner, Textarea } from "@/components/ui";
import { McqOptions } from "@/components/mcq-options";
import { ChatQuestionPanel } from "@/components/chat-question-panel";
import {
  BotBubble,
  GreetingBlock,
  SCRIPT_TYPING_MS,
  TransitionBlock,
  TypingBotMessage,
  TypingIndicator,
  Typewriter,
  UserBubble,
} from "@/components/chat-script";

/** Open answers longer than this get the LLM confirmation loop (PRD 2.5.6). */
const CONFIRM_WORD_THRESHOLD = 25;

/**
 * Non-English detection (PRD Topic 6): Hebrew characters, or a majority of
 * non-Latin letters. Such answers are always translated before display.
 */
function isNonEnglish(text: string): boolean {
  if (/[\u0590-\u05FF]/.test(text)) return true;
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return false;
  const latin = letters.filter((ch) => /[a-zA-Z]/.test(ch)).length;
  return latin / letters.length < 0.5;
}

type ChatFlowProps = {
  state: FunnelState;
  /** Real auth state — guests register before results (freemium gate). */
  registered: boolean;
  onUpdateMcq: (qId: string, next: McqAnswer) => void;
  onSkipMcq: (qId: string) => void;
  onAnswerOpen: (qId: string, text: string) => void;
  onClearAutoFilled: (qId: string) => void;
  onLoadRole: () => void;
  loadingRole: boolean;
  sharpenBusy: boolean;
  onGenerate: () => void;
  generateBusy: boolean;
  onBack: () => void;
  onGreetingReply: (reply: string) => void;
  onBranch: (choice: "continue" | "generate") => void;
  onBranchStart: () => void;
};

/** Phase 2's old milestone line was replaced by the TransitionBlock script. */
const PHASE_INTRO: Record<1 | 3, string> = {
  1: `First, ${MAX_ASKED_MCQ} quick one-tap questions I need to tailor your CV to this job.`,
  3: `Last part — ${MAX_ASKED_OPEN} open questions in your own words. Answer freely; I'll help polish the wording.`,
};

/** The interactive input for one question — MCQ options or a free-text box. */
function AnswerEditor({
  item,
  state,
  onUpdateMcq,
  onAnswerOpen,
}: {
  item: SeqItem;
  state: FunnelState;
  onUpdateMcq: (qId: string, next: McqAnswer) => void;
  onAnswerOpen: (qId: string, text: string) => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const view = questionView(state, item);
  if (item.kind === "mcq") {
    return (
      <McqOptions
        question={item.q}
        answer={state.mcqAnswers[item.q.id]}
        onChange={(next) => onUpdateMcq(item.q.id, next)}
      />
    );
  }
  const suggestion = view.example;
  const answer = state.answers[item.q.id] ?? "";
  /**
   * The AI example used to live only in the placeholder, where a 3-row box
   * cut it off and the only way to use it was to retype it. Showing it in
   * full with a one-click adopt turns it into a starting draft: the value is
   * written straight into the answer, editable like anything the user typed.
   */
  const adopt = () => {
    onAnswerOpen(item.q.id, suggestion);
    // Caret at the end, ready to keep writing rather than overwrite.
    requestAnimationFrame(() => {
      const el = areaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };
  return (
    <>
      {suggestion && (
        <div className="mb-2.5 rounded-[14px] border border-dashed border-border bg-chip/60 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
            Example answer
          </p>
          <p className="mt-0.5 text-[13px] italic leading-snug text-ink-soft">
            {suggestion}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={adopt}
            disabled={answer.trim() === suggestion.trim()}
          >
            {answer.trim() ? "Replace with this example" : "Use this example →"}
          </Button>
        </div>
      )}
      <Textarea
        ref={areaRef}
        autoFocus
        rows={3}
        placeholder={
          suggestion
            ? "Use the example above, or write your own…"
            : "Share the details in your own words…"
        }
        value={answer}
        onChange={(e) => onAnswerOpen(item.q.id, e.target.value)}
      />
    </>
  );
}

/** Renders a completed question's answer as a user bubble. */
function answerText(item: SeqItem, state: FunnelState): string {
  if (item.kind === "mcq") {
    const a = state.mcqAnswers[item.q.id];
    if (!a) return "";
    return formatMcqAnswer(a);
  }
  return (state.answers[item.q.id] ?? "").trim();
}

/**
 * A question's bot bubble with the humanized reveal (PRD Topic 2): typing
 * indicator → fast typewriter over the question text → the "why" hint. Newly
 * asked questions animate; restored history renders statically (`animate` is
 * a mount-time decision, matching TypingBotMessage).
 */
function QuestionBubble({
  view,
  animate,
  onDone,
}: {
  /** Display text for this question — see questionView. */
  view: { question: string; why: string };
  animate: boolean;
  onDone?: () => void;
}) {
  const [phase, setPhase] = useState<"typing" | "reveal" | "done">(
    animate ? "typing" : "done"
  );
  const firedRef = useRef(false);
  const fireDone = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    onDone?.();
  };

  useEffect(() => {
    if (!animate) {
      fireDone();
      return;
    }
    const t = setTimeout(() => setPhase("reveal"), SCRIPT_TYPING_MS);
    return () => clearTimeout(t);
    // Mount-only: `animate` is a mount-time decision by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const why = view.why;
  if (phase === "typing") return <TypingIndicator />;
  return (
    <BotBubble className={phase === "reveal" ? "chat-pop-in" : ""}>
      <span className="font-semibold">
        {phase === "reveal" ? (
          <Typewriter
            text={view.question}
            onDone={() => {
              setPhase("done");
              fireDone();
            }}
          />
        ) : (
          view.question
        )}
      </span>
      {phase === "done" && why && (
        <span
          className={`mt-0.5 block text-[12.5px] text-ink-faint ${
            animate ? "chat-fade-in" : ""
          }`}
        >
          {why}
        </span>
      )}
    </BotBubble>
  );
}

/**
 * One transcript step: optional phase intro → the question bubble → the
 * answer/editor, each gated on the previous message finishing its reveal so
 * bot messages arrive strictly one at a time (PRD Topic 2).
 */
function QuestionStep({
  intro,
  animate,
  view,
  children,
}: {
  intro: string | null;
  animate: boolean;
  view: { question: string; why: string };
  children: ReactNode;
}) {
  const [introDone, setIntroDone] = useState(!animate || !intro);
  const [questionDone, setQuestionDone] = useState(!animate);
  const stepRef = useRef<HTMLDivElement>(null);

  // Once the question finished revealing and the answer editor mounted,
  // bring the WHOLE step — question text, every option and the Continue
  // button — fully into view (PRD questionnaire-flow Topic 1). `nearest`
  // is a no-op when the step is already fully visible, so a tall enough
  // viewport is never disturbed; the scroll margins keep the step clear
  // of the sticky footer below and the card edge above.
  useEffect(() => {
    if (!questionDone || !animate) return;
    const t = setTimeout(() => {
      stepRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 80); // let the editor mount and paint before measuring
    return () => clearTimeout(t);
  }, [questionDone, animate]);

  return (
    <div ref={stepRef} className="flex scroll-mt-4 scroll-mb-24 flex-col gap-3.5">
      {intro && (
        <TypingBotMessage animate={animate} onDone={() => setIntroDone(true)}>
          {intro}
        </TypingBotMessage>
      )}
      {introDone && (
        <QuestionBubble
          view={view}
          animate={animate}
          onDone={() => setQuestionDone(true)}
        />
      )}
      {questionDone && children}
    </div>
  );
}

/**
 * What the user already told us in earlier applications. Those questions are
 * not asked again (buildSequence drops them) — but they must not vanish
 * either, or the answers feeding the CV become invisible and uneditable. Each
 * chip opens the same edit overlay the left panel uses.
 */
function KnownRecap({
  items,
  state,
  onEdit,
}: {
  items: SeqItem[];
  state: FunnelState;
  onEdit: (item: SeqItem) => void;
}) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const shown = open ? items : items.slice(0, 3);
  return (
    <div className="rounded-[16px] border-[1.5px] border-indigo-200 bg-indigo-50/50 p-4">
      <p className="text-[13.5px] font-bold text-indigo-900">
        ⤺ I already know {items.length} thing{items.length === 1 ? "" : "s"} about
        you
      </p>
      <p className="mt-0.5 text-[12.5px] text-indigo-900/70">
        From your earlier applications — I won’t ask again. Tap any to update it.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {shown.map((item) => {
          const answer = answerText(item, state);
          return (
            <button
              key={item.key}
              onClick={() => onEdit(item)}
              title={`${questionView(state, item).question} — tap to edit`}
              className="max-w-full cursor-pointer truncate rounded-full border border-indigo-200 bg-card px-2.5 py-1 text-[12px] text-ink-soft transition-colors hover:border-indigo-400"
            >
              <span className="font-semibold text-ink">{answer || "—"}</span>
              <span className="ms-1.5 text-ink-faint">✎</span>
            </button>
          );
        })}
      </div>
      {items.length > 3 && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-2 cursor-pointer text-[12px] font-semibold text-indigo-700 underline"
        >
          {open ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * The unified conversational data-entry surface (PRD Topic 2). A deterministic
 * bot walks the user through the capped core set (MCQs → open questions) →
 * milestone → optional role-bank MCQs if the user asks for them, with an LLM
 * confirmation loop on longer open answers. The chat
 * timeline is DERIVED from the answer state, so edits from the left panel never
 * disturb it. Reuses McqOptions and the funnel's answer helpers.
 */
export function ChatFlow({
  state,
  registered,
  onUpdateMcq,
  onSkipMcq,
  onAnswerOpen,
  onClearAutoFilled,
  onLoadRole,
  loadingRole,
  sharpenBusy,
  onGenerate,
  generateBusy,
  onBack,
  onGreetingReply,
  onBranch,
  onBranchStart,
}: ChatFlowProps) {
  const seq = useMemo(
    () => buildSequence(state),
    // Rebuild only when the question sets change, not on every answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.mcq, state.questionnaire, state.knownIds]
  );

  // The questions answered in earlier applications, shown as a recap instead
  // of being asked again (see buildSequence).
  const knownItems = useMemo(() => {
    const known = new Set(state.knownIds ?? []);
    if (known.size === 0) return [];
    return buildSequence(state, { includeKnown: true }).filter((it) =>
      known.has(it.q.id)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mcq, state.questionnaire, state.knownIds]);

  // Open questions the user explicitly skipped this session (MCQ skips live in
  // funnel state; open questions have no such field, so track them locally).
  const [skippedIds, setSkippedIds] = useState<string[]>([]);
  const skipped = useMemo(() => new Set(skippedIds), [skippedIds]);

  // The furthest question the conversation has reached. Everything before it is
  // rendered as completed bubbles; the item AT the cursor is interactive.
  const [cursor, setCursor] = useState(0);
  // Confirmation loop state for the current open answer.
  const [confirming, setConfirming] = useState<{
    id: string;
    loading: boolean;
    refined?: string;
  } | null>(null);
  // Editing overlay opened from the left panel.
  const [editingItem, setEditingItem] = useState<SeqItem | null>(null);
  // "Generate my reports" guard during the optional phase (PRD
  // questionnaire-flow Topic 2): confirm before abandoning open questions.
  const [confirmGenerate, setConfirmGenerate] = useState(false);
  // Panel drawer on small screens.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The greeting acknowledgment finished typing — keyed by flow so a new
  // upload resets it (starts done when the greeting completed earlier).
  const [ackDoneFlow, setAckDoneFlow] = useState<string | null>(() =>
    state.greetingDone ? state.flowId : null
  );
  const ackDone = ackDoneFlow === state.flowId;

  const bottomRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const autoSet = useMemo(
    () => new Set(state.autoFilledIds ?? []),
    [state.autoFilledIds]
  );

  /**
   * The core set — everything the flow asks by default: the capped MCQ budget
   * (phase 1) plus the open questions (phase 3). Optional questions (phase 2)
   * only exist after the user opts into the role bank, so they sit outside
   * this count and outside the gate.
   *
   * This used to be phase 1 alone, which put the generate/continue branch
   * BETWEEN the MCQs and the open questions. Once the pool is capped there is
   * no optional tier in between, so that branch would have ended the flow
   * before the open questions were ever asked.
   */
  const core = seq.filter((it) => it.phase !== 2);
  const coreAnswered = core.filter((it) => {
    const st = itemStatus(it, state, skipped);
    return st === "answered" || st === "auto";
  }).length;
  const coreDone = coreAnswered >= core.length;

  const nextUnpassed = (from: number): number => {
    let n = from;
    while (n < seq.length && isPassed(seq[n], state, skipped)) n++;
    return n;
  };

  // Where the transcript stood when this flow first rendered — items before
  // it are history and render without entry animations.
  const initialCursor = useMemo(
    () => nextUnpassed(0),
    // Per-flow only: the frontier must not move as answers land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.flowId]
  );

  // On mount / when a fresh flow loads, jump the cursor to the first question
  // that still needs an answer (auto-filled ones are already passed).
  useEffect(() => {
    setCursor(nextUnpassed(0));
    setConfirming(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.flowId, seq.length]);

  // Keep the newest bubble in view as the conversation advances.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    cursor,
    confirming,
    ackDone,
    state.greetingDone,
    state.branchChoice,
    state.branchStarted,
  ]);

  // Follow the transcript as it grows — typing-indicator → message swaps and
  // typewriter reveals change height after the state effect above has already
  // fired, so this is what makes the scroll a visible glide rather than a
  // pre-layout jump (PRD Topic 3). Skips when the user scrolled up to read
  // history so we never hijack their position.
  useEffect(() => {
    const el = transcriptRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let prev = el.offsetHeight;
    const ro = new ResizeObserver(() => {
      const delta = el.offsetHeight - prev;
      prev = el.offsetHeight;
      if (delta <= 0) return;
      const sc = document.scrollingElement;
      // Measure the distance-from-bottom as it was BEFORE this growth —
      // otherwise a block taller than the threshold reads as "the user
      // scrolled up" and the follow never fires.
      if (sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight - delta > 480)
        return;
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function advance() {
    setConfirming(null);
    setCursor((c) => nextUnpassed(c + 1));
  }

  function handleMcq(qId: string, next: McqAnswer) {
    onUpdateMcq(qId, next);
    if (autoSet.has(qId)) onClearAutoFilled(qId);
  }
  function handleOpen(qId: string, text: string) {
    onAnswerOpen(qId, text);
    if (autoSet.has(qId)) onClearAutoFilled(qId);
  }

  function skipCurrent(item: SeqItem) {
    if (item.kind === "mcq") onSkipMcq(item.q.id);
    else setSkippedIds((s) => [...s, item.q.id]);
    advance();
  }

  /**
   * Continue from the current item. Long English answers hit the confirm
   * loop; non-English answers of ANY length are translated silently — the
   * refined English becomes the answer with no confirmation step, so raw
   * Hebrew never lands in the transcript (PRD Topic 6).
   */
  async function continueFrom(item: SeqItem) {
    if (item.kind !== "open") {
      advance();
      return;
    }
    const text = (state.answers[item.q.id] ?? "").trim();
    if (!text) {
      skipCurrent(item);
      return;
    }
    const foreign = isNonEnglish(text);
    // Value-gated: only longer answers are worth a restate-and-confirm.
    const words = text.split(/\s+/).filter(Boolean).length;
    if (!foreign && words <= CONFIRM_WORD_THRESHOLD) {
      advance();
      return;
    }
    setConfirming({ id: item.q.id, loading: true });
    try {
      const res = await fetch("/api/try/confirm-answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: item.q.question, answer: text }),
      });
      const data = await readJson(res);
      const refined = (data?.refined ?? "").trim();
      if (!refined) {
        advance(); // couldn't rewrite — keep the verbatim answer, move on
        return;
      }
      if (foreign) {
        // Commit the English BEFORE advancing so the bubble renders translated.
        handleOpen(item.q.id, refined);
        advance();
        return;
      }
      setConfirming({ id: item.q.id, loading: false, refined });
    } catch {
      advance();
    }
  }

  /** Approve the rewrite: it becomes the canonical answer, then move on. */
  function acceptRefined(item: SeqItem) {
    if (confirming?.refined) handleOpen(item.q.id, confirming.refined);
    advance();
  }

  const done = cursor >= seq.length;
  const currentItem = done ? null : seq[cursor];
  const visibleCount = done ? seq.length : cursor + 1;

  /* --- Scripted conversational stages (PRD Topic 1) ------------------ */
  // The seq index just past the last core question — where the
  // TransitionBlock sits. buildSequence puts the core set first, so the core
  // items are contiguous and this is simply their count.
  const coreEnd = core.length;
  // Questions render only once the greeting exchange (incl. its ack) ended.
  const greetingReady = state.greetingDone && ackDone;
  // The continue branch actually began — optional questions are unlocked.
  const optionalUnlocked =
    state.branchChoice === "continue" && state.branchStarted;
  const generateUnlocked =
    optionalUnlocked || state.branchChoice === "generate";
  // Unanswered optional questions — drives the generate-confirmation modal
  // (PRD questionnaire-flow Topic 2). Open questions used to count here; they
  // are core now, and the gate below already covers them.
  const remainingOptional = seq.filter(
    (it) => it.phase === 2 && !isPassed(it, state, skipped)
  ).length;

  /**
   * Footer CTA click: while optional questions remain in the continue
   * branch, interpose a confirmation so a misclick can't end the session;
   * otherwise generate directly (unchanged behavior).
   */
  function handleGenerateClick() {
    if (optionalUnlocked && remainingOptional > 0) setConfirmGenerate(true);
    else onGenerate();
  }
  // Past the core questions with no branch opening more: cap the transcript
  // there and show the TransitionBlock at the frontier. The cursor guard
  // matters — coreDone flips before the last "Continue" click.
  const inTransition =
    greetingReady && coreDone && cursor >= coreEnd && !optionalUnlocked;
  const shownCount = !greetingReady
    ? 0
    : inTransition
      ? Math.min(visibleCount, coreEnd)
      : visibleCount;

  /** Right-to-left display language (Hebrew, Arabic) — see i18n.ts. */

  const transitionEl = (
    <TransitionBlock
      branchChoice={state.branchChoice}
      branchStarted={state.branchStarted}
      onChoose={onBranch}
      onStart={onBranchStart}
      onGenerate={onGenerate}
      generateBusy={generateBusy}
      registered={registered}
    />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr] lg:gap-10">
      {/* Left navigation panel (Topic 3) — sidebar on desktop */}
      <aside className="hidden lg:block">
        <div className="sticky top-4 max-h-[calc(100vh-32px)] overflow-y-auto pr-1">
          <ChatQuestionPanel
            seq={seq}
            askedCount={shownCount}
            state={state}
            skipped={skipped}
            onEdit={setEditingItem}
            activeKey={currentItem?.key}
          />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        {/* Mobile: open the question panel as a drawer */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="self-start rounded-full border-[1.5px] border-border bg-card px-3 py-1 text-[12.5px] font-semibold text-ink-soft lg:hidden"
        >
          ☰ Your questions
        </button>

        {/* Standalone chat card (PRD Topic 1) — the transcript and its sticky
            footer live inside one rounded, padded container */}
        <div className="rounded-[16px] border border-border bg-card p-6">
        {/* Chat transcript (derived from answer state) */}
        <div ref={transcriptRef} className="flex flex-col gap-3.5">
          {/* Personalized opening exchange — persists as history once done */}
          <GreetingBlock
            state={state}
            onReply={onGreetingReply}
            onAckDone={() => setAckDoneFlow(state.flowId)}
          />
          {greetingReady && (
            <KnownRecap
              items={knownItems}
              state={state}
              onEdit={setEditingItem}
            />
          )}
          {seq.slice(0, shownCount).map((item, i) => {
            const showPhase = i === 0 || seq[i - 1].phase !== item.phase;
            const isCurrent = !done && i === cursor;
            const status = itemStatus(item, state, skipped);
            const ans = answerText(item, state);
            const isConfirmingThis =
              confirming?.id === item.q.id && item.kind === "open";
            // Entry animations only for items past the mount-time frontier.
            const animateItem = i >= initialCursor;
            // Phase 2 has no intro — the TransitionBlock replaced it.
            const introText =
              showPhase && item.phase !== 2
                ? PHASE_INTRO[item.phase as 1 | 3]
                : null;
            const view = questionView(state, item);
            return (
              <Fragment key={item.key}>
                {/* Once the continue branch starts, the transition script sits
                    at the phase boundary as static transcript history. */}
                {i === coreEnd && optionalUnlocked && transitionEl}
                {/* Phase intro → typing indicator → typewriter question →
                    answer/editor, strictly sequential (PRD Topic 2). */}
                <QuestionStep
                  intro={introText}
                  animate={animateItem}
                  view={view}
                >
                {/* Completed items → answer bubble; current item → editor */}
                {!isCurrent && status === "skipped" && (
                  <UserBubble>
                    <span className="italic text-ink-faint">Skipped</span>
                  </UserBubble>
                )}
                {!isCurrent && (status === "answered" || status === "auto") && (
                  <UserBubble>
                    {ans}
                    {status === "auto" && (
                      <span className="mt-1 block text-[11px] font-semibold text-indigo-600">
                        ⤺ Auto-filled from a recent application · edit in the panel
                      </span>
                    )}
                  </UserBubble>
                )}

                {isCurrent && (
                  <div
                    className={`rounded-[18px] border-[1.5px] border-border bg-card p-4 ${
                      animateItem ? "chat-pop-in" : ""
                    }`}
                  >
                    <AnswerEditor
                      item={item}
                      state={state}
                      onUpdateMcq={handleMcq}
                      onAnswerOpen={handleOpen}
                    />

                    {/* Confirmation loop for a long open answer (PRD 2.5) —
                        approving makes the rewrite the canonical answer */}
                    {isConfirmingThis && confirming && (
                      <div className="mt-3 rounded-[14px] bg-chip p-3">
                        {confirming.loading ? (
                          <Spinner label="Polishing your answer…" />
                        ) : (
                          <>
                            <p className="text-[13.5px] text-ink">
                              Here’s your answer, polished — I’ll use this
                              wording:{" "}
                              <span className="font-semibold">
                                “{confirming.refined}”
                              </span>
                            </p>
                            <div className="mt-2.5 flex gap-2">
                              <Button size="sm" onClick={() => acceptRefined(item)}>
                                Use this wording →
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirming(null)}
                              >
                                No, let me rephrase it
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {!isConfirmingThis && (
                      <div className="mt-3 flex items-center justify-between gap-2">
                        {item.phase !== 1 ? (
                          <button
                            onClick={() => skipCurrent(item)}
                            className="cursor-pointer text-[13px] font-semibold text-ink-faint hover:text-ink-soft"
                          >
                            Skip
                          </button>
                        ) : (
                          <span className="text-[12px] font-semibold text-ink-faint">
                            Required
                          </span>
                        )}
                        <Button
                          size="md"
                          disabled={item.kind === "mcq" && status === "pending"}
                          onClick={() => continueFrom(item)}
                        >
                          Continue →
                        </Button>
                      </div>
                    )}
                  </div>
                )}
                </QuestionStep>
              </Fragment>
            );
          })}

          {/* Post-mandatory branching (PRD 1.5.5-1.5.7) at the frontier */}
          {inTransition && transitionEl}

          {/* More optional questions (role bank) once optional pool is exhausted */}
          {!done &&
            optionalUnlocked &&
            currentItem?.phase === 2 &&
            !state.roleQuestionsLoaded &&
            cursor === seq.length - 1 && (
              <button
                onClick={onLoadRole}
                disabled={loadingRole}
                className="self-start rounded-full border-[1.5px] border-dashed border-accent/60 px-4 py-1.5 text-[13px] font-semibold text-accent hover:bg-selected-bg disabled:opacity-50"
              >
                {loadingRole ? "Adding more…" : "＋ More questions for my role"}
              </button>
            )}

          {sharpenBusy && optionalUnlocked && currentItem?.phase === 3 && (
            <Spinner label="Drafting example answers from your CV…" />
          )}

          {done && generateUnlocked && (
            <TypingBotMessage animate={initialCursor < seq.length}>
              All set — generate your CV and interview report whenever you’re
              ready.
            </TypingBotMessage>
          )}
          {/* Scroll sentinel — the bottom margin keeps auto-scrolled content
              clear of the sticky footer below (PRD Topics 3 & 5). */}
          <div ref={bottomRef} className="scroll-mb-24" />
        </div>

        {/* Sticky action footer. Generate appears only once a branch resolved
            (PRD 1.5.7) — before that the CTA lives inside the chat script. */}
        <div className="sticky bottom-0 z-10 -mx-6 -mb-6 mt-4 flex items-center justify-between gap-3 rounded-b-[16px] border-t border-border bg-card/90 px-6 py-3 backdrop-blur">
          <Button variant="ghost" size="md" onClick={onBack}>
            ← Back
          </Button>
          <div className="flex items-center gap-3">
            {!coreDone && (
              <span className="text-[12.5px] text-ink-faint">
                {coreAnswered}/{core.length} questions
              </span>
            )}
            {generateUnlocked && (
              <Button
                size="lg"
                disabled={!coreDone || generateBusy}
                onClick={handleGenerateClick}
                className={
                  coreDone ? "ring-2 ring-accent/30 ring-offset-2" : ""
                }
              >
                {generateBusy ? (
                  <Spinner label="Generating…" />
                ) : registered ? (
                  "Generate my reports →"
                ) : (
                  "Register to see your results →"
                )}
              </Button>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* Mobile drawer for the question panel */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex bg-ink/40 lg:hidden"
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="h-full w-[280px] max-w-[80%] overflow-y-auto bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <ChatQuestionPanel
              seq={seq}
              askedCount={shownCount}
              state={state}
              skipped={skipped}
              onEdit={(item) => {
                setDrawerOpen(false);
                setEditingItem(item);
              }}
              activeKey={currentItem?.key}
            />
          </div>
        </div>
      )}

      {/* Confirm leaving the optional questions to generate (PRD
          questionnaire-flow Topic 2) — cancel returns to the flow intact. */}
      <Modal
        open={confirmGenerate}
        onClose={() => setConfirmGenerate(false)}
        title="Finish now?"
      >
        <p className="text-[14.5px] leading-relaxed text-ink-soft">
          You have{" "}
          <span className="font-bold text-ink">
            {remainingOptional} optional question
            {remainingOptional === 1 ? "" : "s"}
          </span>{" "}
          left. Want to wrap up here? Everything you&apos;ve answered so far is
          saved.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="md"
            onClick={() => setConfirmGenerate(false)}
          >
            Continue answering
          </Button>
          <Button
            size="md"
            onClick={() => {
              setConfirmGenerate(false);
              onGenerate();
            }}
          >
            Yes, finish →
          </Button>
        </div>
      </Modal>

      {/* Inline editing overlay (Topic 3) — writes are realtime; Done closes */}
      <Modal
        open={Boolean(editingItem)}
        onClose={() => setEditingItem(null)}
        title="Edit your answer"
      >
        {editingItem && (
          <div>
            <p className="mb-3 text-[14.5px] font-semibold text-ink">
              {questionView(state, editingItem).question}
            </p>
            <AnswerEditor
              item={editingItem}
              state={state}
              onUpdateMcq={handleMcq}
              onAnswerOpen={handleOpen}
            />
            <div className="mt-4 flex justify-end">
              <Button onClick={() => setEditingItem(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

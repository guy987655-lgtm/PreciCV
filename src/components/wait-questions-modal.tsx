"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { McqAnswer, formatMcqAnswer, isMcqAnswered } from "@/lib/funnel";
import { resolveTopic } from "@/lib/topics";
import { MasterProfile, McqQuestionnaire } from "@/lib/types";
import { Button, Modal, Spinner } from "@/components/ui";
import { McqOptions } from "@/components/mcq-options";

type McqQuestion = McqQuestionnaire["questions"][number];

/**
 * Something useful to do while a bulk generation runs.
 *
 * Tailoring five CVs is minutes of waiting, and a static progress bar is where
 * users abandon. This offers the optional role-question bank in the meantime:
 * every answer lands on the user's card (POST /api/answers, the same shape My
 * Card writes), so the wait enriches the profile and shortens every future
 * questionnaire instead of being dead time.
 *
 * Strictly optional and strictly interruptible — backdrop, Escape and an
 * explicit button all close it, and the parent never reopens it for that run.
 */
export function WaitQuestionsModal({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  /** The signed-in user's parsed profile — the question bank is built from it. */
  profile: MasterProfile | null;
  onClose: () => void;
}) {
  const [questions, setQuestions] = useState<McqQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, McqAnswer>>({});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  /** The bank is fetched once per mount, however often the modal reopens. */
  const fetched = useRef(false);

  // The shared Modal has no Escape handling of its own (see components/ui).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const load = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/try/role-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile,
          existingTopics: [],
          existingQuestions: [],
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data?.error ?? "Could not load questions");
      const pool: McqQuestionnaire = data.mcq ?? { questions: [] };

      /**
       * Never ask something the user has already told us — the same matcher
       * the funnel uses for progressive profiling. Signed-out callers get an
       * empty match with a 200, so this is safe to call unconditionally.
       */
      let known = new Set<string>();
      try {
        const m = await fetch("/api/answers/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mcq: pool, questionnaire: null }),
        });
        if (m.ok) {
          const matched = await readJson(m);
          known = new Set<string>(matched.knownIds ?? []);
        }
      } catch {
        // A failed match only costs a repeated question — not worth failing on.
      }

      setQuestions(pool.questions.filter((q) => !known.has(q.id)));
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [profile]);

  useEffect(() => {
    if (!open || fetched.current) return;
    fetched.current = true;
    void load();
  }, [open, load]);

  /** Persist one answer to the account. Best-effort — the wait is the point. */
  function save(question: McqQuestion, answer: McqAnswer) {
    void fetch("/api/answers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answers: [
          {
            question: question.question,
            answer: formatMcqAnswer(answer),
            kind: "mcq",
            topic: resolveTopic(question.topic, question.question),
            selected: answer.selected ?? [],
            other: answer.other,
            options: question.options,
            selectType: question.selectType,
          },
        ],
      }),
    }).catch(() => {
      /* best-effort — nothing here is worth interrupting the wait for */
    });
    setSavedCount((n) => n + 1);
  }

  const current = questions[index];
  const answer = current ? answers[current.id] : undefined;
  const answered = isMcqAnswered(answer);
  const done = !loading && !failed && questions.length > 0 && !current;

  function next(persist: boolean) {
    if (persist && current && answer) save(current, answer);
    setIndex((i) => i + 1);
  }

  return (
    <Modal open={open} onClose={onClose} title="While we work — got a minute?">
      <p className="text-[14.5px] leading-relaxed text-ink-soft">
        Your CVs are still building. These are optional questions about your
        role — each one you answer lands on{" "}
        <span className="font-semibold text-ink">your card</span>, so future
        applications ask you less. Leave whenever you like.
      </p>

      <div className="mt-4">
        {loading && <Spinner label="Finding questions for your role…" />}

        {failed && (
          <div className="text-[14px] text-ink-soft">
            <p>We couldn&apos;t load the questions just now.</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={load}>
              Try again
            </Button>
          </div>
        )}

        {!loading && !failed && questions.length === 0 && (
          <p className="text-[14px] text-ink-soft">
            Nothing new to ask — you&apos;ve already told us everything this
            bank covers. Sit tight, your files are on the way.
          </p>
        )}

        {current && (
          <>
            <p className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">
              {current.topic || "About your role"} · {index + 1} of{" "}
              {questions.length}
            </p>
            <p className="mt-1 text-[15px] font-semibold text-ink">
              {current.question}
            </p>
            <div className="mt-3">
              <McqOptions
                question={current}
                answer={answer}
                onChange={(nextAnswer) =>
                  setAnswers((a) => ({ ...a, [current.id]: nextAnswer }))
                }
              />
            </div>
          </>
        )}

        {done && (
          <p className="text-[14px] text-ink-soft">
            That&apos;s the lot — thank you. {savedCount} answer
            {savedCount === 1 ? "" : "s"} saved to your card.
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={onClose}
          className="cursor-pointer text-[13px] font-semibold text-ink-faint underline hover:text-ink-soft"
        >
          {savedCount > 0 ? "Done for now" : "Not now"}
        </button>
        {current && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => next(false)}>
              Skip
            </Button>
            <Button size="md" disabled={!answered} onClick={() => next(true)}>
              Save &amp; next →
            </Button>
          </div>
        )}
      </div>

      {savedCount > 0 && current && (
        <p className="mt-2 text-right text-[12px] text-ink-faint">
          {savedCount} saved to your card
        </p>
      )}
    </Modal>
  );
}

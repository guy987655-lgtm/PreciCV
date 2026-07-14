"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import { FunnelState } from "@/lib/funnel";
import { Button, Spinner, Textarea, Tooltip } from "@/components/ui";

/**
 * Scripted conversational beats for the chat funnel (PRD Topic 1): the
 * WhatsApp-style typing indicator, the personalized greeting exchange, and
 * the post-mandatory branching transition. These render AROUND the derived
 * question transcript in ChatFlow and persist as history once completed —
 * progress flags live in FunnelState so reloads resume statically.
 */

/** How long the three-dot "typing…" indicator shows before a message lands. */
export const SCRIPT_TYPING_MS = 1300;

/** A typewriter reveal always completes within this budget, however long. */
const TYPEWRITER_MAX_MS = 1100;
const TYPEWRITER_TICK_MS = 24;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Fast character-by-character text reveal. Chars-per-tick scales with length
 * so any message lands within ~TYPEWRITER_MAX_MS; honors reduced motion.
 */
export function Typewriter({
  text,
  onDone,
}: {
  text: string;
  onDone?: () => void;
}) {
  const [count, setCount] = useState(() =>
    prefersReducedMotion() ? text.length : 0
  );
  const doneRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (count < text.length) return;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (doneRef.current) return;
    doneRef.current = true;
    onDone?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, text]);

  useEffect(() => {
    if (count >= text.length) return; // reduced motion / empty text
    // Elapsed-time based (not per-tick) so throttled timers — background
    // tabs etc. — still land the full text within the budget.
    const start = performance.now();
    const t = setInterval(() => {
      const frac = Math.min(
        1,
        (performance.now() - start) / TYPEWRITER_MAX_MS
      );
      setCount(Math.max(1, Math.round(frac * text.length)));
    }, TYPEWRITER_TICK_MS);
    intervalRef.current = t;
    return () => clearInterval(t);
    // Mount-only: `text` is stable for a given message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  return <>{text.slice(0, count)}</>;
}

export function BotBubble({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-extrabold text-white">
        ✦
      </span>
      <div
        className={`max-w-[85%] rounded-[18px] rounded-tl-md bg-chip px-4 py-2.5 text-[14.5px] leading-relaxed text-ink ${className}`}
      >
        {children}
      </div>
    </div>
  );
}

export function UserBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-[18px] rounded-tr-md bg-selected-bg px-4 py-2.5 text-[14.5px] leading-relaxed text-ink">
        {children}
      </div>
    </div>
  );
}

/** The recruiter is "typing…" — three staggered bouncing dots in a bot bubble. */
export function TypingIndicator() {
  return (
    <BotBubble>
      <span className="flex items-center gap-1 py-1" aria-label="typing…">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot inline-block h-1.5 w-1.5 rounded-full bg-ink-faint"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </span>
    </BotBubble>
  );
}

/**
 * WhatsApp-style bot message: shows the typing indicator for `typingMs`, then
 * reveals the message — string children get a fast typewriter reveal, JSX
 * children pop in whole — and `onDone` fires once the reveal completes.
 * `animate` is read once at mount — completed messages render statically
 * (e.g. after a reload).
 */
export function TypingBotMessage({
  children,
  animate,
  typingMs = SCRIPT_TYPING_MS,
  onDone,
}: {
  children: ReactNode;
  animate: boolean;
  typingMs?: number;
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

  const typeable = typeof children === "string";

  useEffect(() => {
    if (!animate) {
      fireDone();
      return;
    }
    const t = setTimeout(() => {
      if (typeable) {
        setPhase("reveal");
      } else {
        setPhase("done");
        fireDone();
      }
    }, typingMs);
    return () => clearTimeout(t);
    // Mount-only: `animate` is a mount-time decision by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "typing") return <TypingIndicator />;
  if (phase === "reveal" && typeable) {
    return (
      <BotBubble className="chat-pop-in">
        <Typewriter
          text={children as string}
          onDone={() => {
            setPhase("done");
            fireDone();
          }}
        />
      </BotBubble>
    );
  }
  return <BotBubble className={animate && !typeable ? "chat-pop-in" : ""}>{children}</BotBubble>;
}

/** Chains several TypingBotMessages sequentially; `onDone` fires after the last. */
export function ScriptedBotMessages({
  messages,
  animate,
  onDone,
}: {
  messages: ReactNode[];
  animate: boolean;
  onDone?: () => void;
}) {
  const [revealed, setRevealed] = useState(animate ? 1 : messages.length);
  return (
    <>
      {messages.slice(0, revealed).map((m, i) => (
        <TypingBotMessage
          key={i}
          animate={animate}
          onDone={() => {
            if (i === messages.length - 1) onDone?.();
            else setRevealed((r) => Math.max(r, i + 2));
          }}
        >
          {m}
        </TypingBotMessage>
      ))}
    </>
  );
}

/**
 * The personalized opening exchange (PRD 1.5.2-1.5.4): greeting built from the
 * parsed CV + JD-derived GreetingInfo, a one-time free-text reply, and a
 * canned acknowledgment. Renders statically as history once greetingDone.
 */
export function GreetingBlock({
  state,
  onReply,
  onAckDone,
}: {
  state: FunnelState;
  onReply: (text: string) => void;
  /** The acknowledgment finished typing — ChatFlow may reveal the questions. */
  onAckDone: () => void;
}) {
  // Was the greeting still live when this block mounted? False = reload history.
  const [live] = useState(() => !state.greetingDone);
  const [scriptDone, setScriptDone] = useState(state.greetingDone);
  const [draft, setDraft] = useState("");

  const profile = state.profile;
  const info = state.greetingInfo;
  const first =
    (profile?.contact.fullName ?? "").trim().split(/\s+/)[0] || "there";
  const currentTitle =
    profile?.experience?.[0]?.title || profile?.headline || "";

  const messages: ReactNode[] =
    info?.targetJobTitle && currentTitle
      ? [
          `Hi ${first}, I see you are a ${currentTitle} and you're interested in the ${info.targetJobTitle} position.`,
          info.sameField
            ? info.field
              ? `Makes sense, looking to stay in the ${info.field} field, huh?`
              : "Makes sense, staying on the same path, huh?"
            : "I see you're looking to step outside your original role. How about we make some adjustments?",
        ]
      : [
          `Hi ${first}! I've read your CV and the job you're targeting — let's tailor your CV together.`,
        ];

  return (
    <>
      <ScriptedBotMessages
        messages={messages}
        animate={live}
        onDone={() => setScriptDone(true)}
      />

      {/* One-time free-text reply (PRD: "await user input to proceed") */}
      {scriptDone && !state.greetingDone && (
        <div className="chat-pop-in rounded-[18px] border-[1.5px] border-border bg-card p-4">
          <Textarea
            autoFocus
            rows={2}
            placeholder="Say anything — or tell me a bit about what you're looking for…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              onClick={() => onReply("")}
              className="cursor-pointer text-[13px] font-semibold text-ink-faint hover:text-ink-soft"
            >
              Skip
            </button>
            <Button size="md" onClick={() => onReply(draft.trim())}>
              Send →
            </Button>
          </div>
        </div>
      )}

      {state.greetingDone && state.greetingReply && (
        <UserBubble>{state.greetingReply}</UserBubble>
      )}
      {state.greetingDone && (
        <TypingBotMessage animate={live} onDone={onAckDone}>
          {state.greetingReply
            ? "Love it — thanks for sharing. Now, a few quick questions to nail this application."
            : "No problem — let's jump straight in."}
        </TypingBotMessage>
      )}
    </>
  );
}

const TRANSITION_MSG =
  "Great! So we've basically finished the mandatory questions and can start " +
  "generating the files. Or, you can continue answering more questions so we " +
  "might discover an important detail for the final version—and even if not, " +
  "at least we'll have a bit more info about you for future jobs.";
const CONTINUE_MSG =
  "Great, let's continue. You can start generating the reports whenever you " +
  "feel like you've had enough.";
const GENERATE_MSG =
  "No problem. Just say the word and I'll start generating your CV.";

/**
 * Post-mandatory transition (PRD 1.5.5-1.5.7): milestone message, side-by-side
 * branch buttons, and the per-branch follow-up. ChatFlow renders it at the
 * frontier while a choice is pending and inline (as static history) at the
 * phase boundary once the continue branch starts.
 */
export function TransitionBlock({
  branchChoice,
  branchStarted,
  onChoose,
  onStart,
  onGenerate,
  generateBusy,
}: {
  branchChoice: FunnelState["branchChoice"];
  branchStarted: boolean;
  onChoose: (choice: "continue" | "generate") => void;
  onStart: () => void;
  onGenerate: () => void;
  generateBusy: boolean;
}) {
  // Live while the choice is still pending at mount; otherwise static history.
  const [live] = useState(() => branchChoice === "");
  const [introDone, setIntroDone] = useState(!live);
  const [followUpDone, setFollowUpDone] = useState(!live);

  return (
    <>
      <TypingBotMessage animate={live} onDone={() => setIntroDone(true)}>
        {TRANSITION_MSG}
      </TypingBotMessage>

      {/* PRD 1.5.6 — the two options SIDE-BY-SIDE, never stacked. Continue is
          the green pill, Generate the white one; each explains itself in a
          tooltip (hover / focus, touch-reachable). */}
      {branchChoice === "" && introDone && (
        <div className="chat-pop-in flex flex-row flex-wrap items-center gap-2 pl-[42px]">
          <Tooltip label="You can continue answering more questions so we might discover an important detail for the final version—and even if not, at least we'll have a bit more info about you for future jobs.">
            <Button size="md" onClick={() => onChoose("continue")}>
              Continue
            </Button>
          </Tooltip>
          <Tooltip label="At this stage, the system begins generating your CV.">
            <Button size="md" variant="white" onClick={() => onChoose("generate")}>
              Generate CV and report
            </Button>
          </Tooltip>
        </div>
      )}

      {branchChoice !== "" && (
        <UserBubble>
          {branchChoice === "continue" ? "Continue" : "Generate CV and report"}
        </UserBubble>
      )}

      {branchChoice === "continue" && (
        <>
          <TypingBotMessage
            animate={live}
            onDone={() => setFollowUpDone(true)}
          >
            {CONTINUE_MSG}
          </TypingBotMessage>
          {!branchStarted && followUpDone && (
            <div className="chat-pop-in pl-[42px]">
              <Button size="md" onClick={onStart}>
                Let&apos;s Start →
              </Button>
            </div>
          )}
        </>
      )}

      {branchChoice === "generate" && (
        <>
          <TypingBotMessage
            animate={live}
            onDone={() => setFollowUpDone(true)}
          >
            {GENERATE_MSG}
          </TypingBotMessage>
          {followUpDone && (
            <div className="chat-pop-in pl-[42px]">
              <Button size="lg" disabled={generateBusy} onClick={onGenerate}>
                {generateBusy ? (
                  <Spinner label="Generating…" />
                ) : (
                  "Generate Reports →"
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}

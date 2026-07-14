"use client";

import { FunnelState } from "@/lib/funnel";
import { ItemStatus, SeqItem, itemStatus } from "@/lib/chat-seq";

const PHASE_LABEL: Record<1 | 2 | 3, string> = {
  1: "Required",
  2: "Optional",
  3: "In your words",
};

const STATUS_META: Record<
  ItemStatus,
  { dot: string; label: string; labelCls: string }
> = {
  answered: { dot: "bg-accent", label: "Answered", labelCls: "text-accent" },
  auto: { dot: "bg-indigo-500", label: "Auto-populated", labelCls: "text-indigo-600" },
  skipped: { dot: "bg-border-strong", label: "Skipped", labelCls: "text-muted" },
  pending: { dot: "bg-transparent border-2 border-placeholder", label: "", labelCls: "" },
};

/**
 * List of the questions the bot has already asked, each with a live status
 * flag (Answered / Auto-populated / Skipped / pending). Questions past the
 * transcript frontier (`askedCount`) stay hidden behind a dimmed "+X more"
 * row so the chat reveal isn't spoiled. Clicking a row opens the inline
 * editor (owned by the parent) — the chat timeline is never disturbed.
 */
export function ChatQuestionPanel({
  seq,
  askedCount,
  state,
  skipped,
  onEdit,
  activeKey,
}: {
  seq: SeqItem[];
  /** How many questions the chat has revealed — only these are listed. */
  askedCount: number;
  state: FunnelState;
  skipped: Set<string>;
  onEdit: (item: SeqItem) => void;
  activeKey?: string;
}) {
  const visible = seq.slice(0, Math.max(0, askedCount));
  const hidden = seq.length - visible.length;
  return (
    <nav aria-label="Your questions" className="flex flex-col gap-1">
      <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-faint">
        Your questions
      </p>
      {visible.map((item, i) => {
        const status = itemStatus(item, state, skipped);
        const meta = STATUS_META[status];
        const showPhase = i === 0 || visible[i - 1].phase !== item.phase;
        return (
          <div key={item.key}>
            {showPhase && (
              <p className="mt-2 px-2 pb-0.5 text-[10.5px] font-bold uppercase tracking-[0.06em] text-muted">
                {PHASE_LABEL[item.phase]}
              </p>
            )}
            <button
              onClick={() => onEdit(item)}
              title="Edit this answer"
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-chip ${
                item.key === activeKey ? "bg-chip" : ""
              }`}
            >
              <span
                className={`mt-[3px] h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`}
              />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[12.5px] leading-snug text-ink-soft">
                  {i + 1}. {item.q.question}
                </span>
                {meta.label && (
                  <span className={`text-[10.5px] font-semibold ${meta.labelCls}`}>
                    {meta.label}
                  </span>
                )}
              </span>
            </button>
          </div>
        );
      })}
      {hidden > 0 && (
        <p className="mt-2 px-2 text-[12px] font-medium italic text-muted">
          +{hidden} more question{hidden === 1 ? "" : "s"}…
        </p>
      )}
    </nav>
  );
}

import { FunnelState, isMcqAnswered } from "./funnel";

/**
 * Aggregation for the My Card progress chart (PRD v2 Topic 10): how many
 * UNIQUE questions the user has answered, cumulative per month, across the
 * active flow and every archived History flow.
 *
 * "Unique" dedupes by normalized question TEXT (not id): LLM-generated ids
 * repeat across flows for different questions, while the same question can
 * reappear under a new id — text is the honest identity. Each question
 * counts once, at its EARLIEST recorded answer time; answers saved before
 * per-answer timestamps existed fall back to the flow's savedAt.
 */

export type MonthBucket = {
  /** Sortable "YYYY-MM" key. */
  key: string;
  /** Short axis label, e.g. "Jul 26". */
  label: string;
  /** Unique questions answered up to and including this month. */
  cumulative: number;
};

function monthKey(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function cumulativeUniqueAnswered(flows: FunnelState[]): MonthBucket[] {
  // question identity → earliest time it was answered
  const earliest = new Map<string, number>();
  for (const f of flows) {
    const fallback = f.savedAt || Date.now();
    const texts = new Map<string, string>();
    for (const q of f.mcq?.questions ?? []) texts.set(q.id, q.question);
    for (const q of f.questionnaire?.questions ?? []) texts.set(q.id, q.question);
    const record = (qid: string, answered: boolean) => {
      if (!answered) return;
      const key =
        texts.get(qid)?.trim().toLowerCase() || `${f.flowId}:${qid}`;
      const t = f.answerTimes?.[qid] || fallback;
      const prev = earliest.get(key);
      if (prev === undefined || t < prev) earliest.set(key, t);
    };
    for (const [qid, a] of Object.entries(f.mcqAnswers ?? {})) {
      record(qid, isMcqAnswered(a));
    }
    for (const [qid, v] of Object.entries(f.answers ?? {})) {
      record(qid, (v ?? "").trim().length > 0);
    }
  }
  if (earliest.size === 0) return [];

  const perMonth = new Map<string, number>();
  for (const t of earliest.values()) {
    const k = monthKey(t);
    perMonth.set(k, (perMonth.get(k) ?? 0) + 1);
  }

  // Continuous month range: first month with data → current month.
  const firstKey = [...perMonth.keys()].sort()[0];
  const nowKey = monthKey(Date.now());
  let [y, m] = firstKey.split("-").map(Number);
  const out: MonthBucket[] = [];
  let cumulative = 0;
  // Hard cap keeps a corrupted timestamp from producing a runaway axis.
  while (out.length < 60) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    cumulative += perMonth.get(key) ?? 0;
    out.push({
      key,
      label: new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
        month: "short",
        year: "2-digit",
      }),
      cumulative,
    });
    if (key >= nowKey) break;
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

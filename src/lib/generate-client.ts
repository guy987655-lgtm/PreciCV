import { readJson } from "./fetch-json";
import type { MasterProfile } from "./types";

/**
 * Topic 1 — resilient client for the funnel's initial CV + report generation.
 *
 * The generation endpoint fails intermittently on the first attempt (LLM
 * cold start / brief overload, serverless warm-up, or a gateway timeout on a
 * 60–90s request). Those are all transient, so we retry silently instead of
 * surfacing an error the moment the user finishes the questionnaire. The
 * caller keeps its loading state up across the whole budget; only a hard
 * failure after every retry is exhausted throws.
 */

/** Total wall-clock budget for all attempts combined (§1.7.4). */
const TOTAL_BUDGET_MS = 165_000;
/** Backoff between attempts — short, since each attempt itself is long. */
const BACKOFF_MS = [1_500, 3_000, 4_500, 6_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wraps a terminal failure so the retry loop rethrows it instead of retrying. */
class NonRetryableError extends Error {
  constructor(readonly cause: Error) {
    super(cause.message);
    this.name = "NonRetryableError";
  }
}

/** HTTP statuses worth retrying — transient server/gateway failures. */
function isRetryableStatus(status: number): boolean {
  // 408 request timeout, 5xx server/gateway errors (incl. Vercel 504, 502
  // from our own route on a generation failure, 529-style overload).
  return status === 408 || status >= 500;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenerateData = Record<string, any> & { quota?: string };

/**
 * Calls /api/try/generate, retrying transient failures within TOTAL_BUDGET_MS.
 * Returns the parsed payload on success, or `{ quota }` when the daily free
 * limit is hit (a terminal, user-facing state — never retried). Throws only
 * after the budget is exhausted or on a non-retryable error (e.g. 400).
 */
export async function generateWithRetry(
  profile: MasterProfile,
  jdText: string
): Promise<GenerateData> {
  const deadline = Date.now() + TOTAL_BUDGET_MS;
  let attempt = 0;
  let lastError: Error = new Error("Generation failed");

  // Always run the first attempt; keep retrying while there is budget left.
  while (attempt === 0 || Date.now() < deadline) {
    try {
      const res = await fetch("/api/try/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile, jdText }),
      });
      const data = await readJson(res);

      // Daily free limit — terminal, surfaced to the user (not an error).
      if (res.status === 429) {
        return { quota: data.message ?? "Daily free limit reached." };
      }
      if (res.ok) return data as GenerateData;

      const message: string = data.error ?? `Generation failed (${res.status})`;
      // Non-transient (e.g. 400 invalid payload, 503 not configured) — no
      // point retrying, fail immediately.
      if (!isRetryableStatus(res.status)) {
        throw new NonRetryableError(new Error(message));
      }
      lastError = new Error(message);
    } catch (e) {
      // A non-retryable HTTP failure already recorded above rethrows here —
      // let it propagate; retrying it can't help.
      if (e instanceof NonRetryableError) throw e.cause;
      // Network error / aborted request — treat as transient and retry.
      lastError = e instanceof Error ? e : new Error("Generation failed");
    }

    const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt++;
    // Stop if the next backoff would push us past the deadline anyway.
    if (Date.now() + wait >= deadline) break;
    await sleep(wait);
  }

  throw lastError;
}

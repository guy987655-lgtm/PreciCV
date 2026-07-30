import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The daily free-generation cap for signed-in users.
 *
 * The count is DERIVED, never stored: "this user's revision-0 generations
 * created today whose job has no paid purchase". That single definition also
 * implements the pay-back rule for free — buying a job removes its generation
 * from the count, so five generated + one paid reads as four used, with no
 * counter column, no webhook change and no backfill.
 *
 * `generations.is_sample` is deliberately NOT the signal: the payment webhook
 * never touches it (it flips lazily, in /api/generate, only if the user comes
 * back), so a paid job can sit there still flagged as a sample.
 *
 * Server-only in practice, but it takes the caller's SupabaseClient rather than
 * building one, so it stays importable from any route and runs as the USER —
 * RLS ("own generations" / "own purchases") is what makes the queries safe.
 */

export const FREE_GENERATIONS_PER_DAY = 5;

/** How many rows a single day could plausibly hold — a sanity bound, not a cap. */
const MAX_ROWS_SCANNED = 200;

export type FreeQuota = {
  limit: number;
  /** Unpaid revision-0 generations inside today's window. */
  used: number;
  /** Free generations left BEFORE the current request. */
  remaining: number;
  /** When the window rolls over, ISO. */
  resetAt: string;
  allowed: boolean;
};

/**
 * Today, in UTC.
 *
 * A calendar day rather than a rolling 24h window: it gives one fixed reset
 * instant that can actually be stated to the user, where a rolling window's
 * expiry would shift every time a purchase credited a slot back. Anchoring the
 * day is only possible because the count is derived from stored rows — the
 * cookie-based limiter this replaced had no server-side history, so it could
 * only ever be a rolling window.
 */
export function utcDayWindow(now: Date = new Date()): {
  start: Date;
  resetAt: Date;
} {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const resetAt = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, resetAt };
}

export async function readFreeQuota(
  supabase: SupabaseClient,
  userId: string,
  limit: number = FREE_GENERATIONS_PER_DAY
): Promise<FreeQuota> {
  const { start, resetAt } = utcDayWindow();
  const base = {
    limit,
    resetAt: resetAt.toISOString(),
  };

  const { data: gens, error } = await supabase
    .from("generations")
    .select("job_id")
    .eq("user_id", userId)
    .eq("revision_number", 0)
    .gte("created_at", start.toISOString())
    .limit(MAX_ROWS_SCANNED);

  /**
   * Fail OPEN, on purpose. This gate is a cost control, not a security
   * boundary, and a transient database error must not wall a paying user out
   * of the thing they came for. The blast radius is the length of the outage.
   * Please do not "fix" this into a fail-closed check.
   */
  if (error) {
    console.error("[free-quota] could not count generations:", error);
    return { ...base, used: 0, remaining: limit, allowed: true };
  }

  const jobIds = [...new Set((gens ?? []).map((g) => g.job_id as string))];
  let paid = new Set<string>();
  if (jobIds.length > 0) {
    // `pending` purchases must NOT count as paid: /api/payments/checkout mints
    // a pending row for free, so crediting those back would be an unlimited
    // free-generation hole.
    const { data: purchases, error: purchaseError } = await supabase
      .from("purchases")
      .select("job_id")
      .eq("user_id", userId)
      .eq("status", "paid")
      .in("job_id", jobIds);
    if (purchaseError) {
      console.error("[free-quota] could not read purchases:", purchaseError);
      return { ...base, used: 0, remaining: limit, allowed: true };
    }
    paid = new Set((purchases ?? []).map((p) => p.job_id as string));
  }

  const used = jobIds.filter((id) => !paid.has(id)).length;
  return {
    ...base,
    used,
    remaining: Math.max(0, limit - used),
    allowed: used < limit,
  };
}

/**
 * The "you're out of free generations for today" answer.
 *
 * 429 rather than 402: `payment_required` already means "this job needs a
 * purchase" and the client turns it into "Purchase a tier below to generate",
 * whereas this is a state that buying OR waiting resolves. The copy says both.
 */
export function freeLimitResponse(
  quota: FreeQuota,
  opts: { justPaid?: boolean } = {}
): NextResponse {
  const resetAt = new Date(quota.resetAt);
  const message =
    (opts.justPaid
      ? "Just paid? We're still confirming your payment — one moment. "
      : "") +
    `You've used all ${quota.limit} free CVs for today. ` +
    `Buying this one generates it right now — paid CVs don't count toward ` +
    `the free limit — or come back after ${resetAt.toUTCString()}.`;

  const res = NextResponse.json(
    {
      error: "daily_limit_reached",
      message,
      limit: quota.limit,
      used: quota.used,
      remaining: 0,
      resetAt: quota.resetAt,
    },
    { status: 429 }
  );
  const seconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
  res.headers.set("Retry-After", String(seconds));
  return res;
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CreditBalance,
  CreditOrder,
  EMPTY_BALANCE,
} from "@/lib/credit-types";

export { EMPTY_BALANCE };
export type { CreditBalance, CreditOrder };

/**
 * Credit balance — how many bundle unlocks the user has left.
 *
 * DERIVED, never stored: for each paid order, `credits_total` minus the number
 * of `purchases` rows pointing at it. Same discipline as the daily free cap in
 * free-quota.ts — one definition, no counter column that can drift out of step
 * with reality, and a refund that removes purchases returns the credits with no
 * extra code.
 *
 * Unlike free-quota.ts this fails CLOSED. That gate is a cost control, where
 * refusing a paying user is the worse outcome; this one decides entitlement,
 * so a database error must read as "no credits" (the user is offered checkout)
 * rather than "unlimited credits". Nothing is granted here anyway — the
 * authoritative spend is the spend_credit() function in migration 0010, which
 * re-checks under a row lock. This is the display-and-routing read.
 *
 * Takes the caller's client rather than building one, so it runs as the USER
 * and RLS ("own orders read" / "own purchases") is what makes it safe.
 */

type OrderRow = {
  id: string;
  sku: string;
  credits_total: number;
  created_at: string;
};

export async function readCreditBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<CreditBalance> {
  const { data: orderRows, error } = await supabase
    .from("orders")
    .select("id, sku, credits_total, created_at")
    .eq("user_id", userId)
    .eq("status", "paid")
    // FIFO: oldest first, matching the spend order.
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[credits] could not read orders:", error);
    return EMPTY_BALANCE;
  }
  const orders = (orderRows ?? []) as OrderRow[];
  if (orders.length === 0) return EMPTY_BALANCE;

  const ids = orders.map((o) => o.id);
  const { data: spent, error: spentError } = await supabase
    .from("purchases")
    .select("order_id")
    .eq("user_id", userId)
    .in("order_id", ids);

  if (spentError) {
    console.error("[credits] could not count spent credits:", spentError);
    return EMPTY_BALANCE;
  }

  const usedBy = new Map<string, number>();
  for (const row of spent ?? []) {
    const key = row.order_id as string | null;
    if (key) usedBy.set(key, (usedBy.get(key) ?? 0) + 1);
  }

  let total = 0;
  const detailed: CreditOrder[] = orders.map((o) => {
    const used = usedBy.get(o.id) ?? 0;
    const left = Math.max(0, o.credits_total - used);
    total += left;
    return {
      id: o.id,
      sku: o.sku,
      creditsTotal: o.credits_total,
      creditsUsed: used,
      creditsLeft: left,
      createdAt: o.created_at,
    };
  });

  return { total, orders: detailed };
}

/* ------------------------------------------------------------------ */
/* Spending                                                            */
/* ------------------------------------------------------------------ */

export type SpendResult =
  | { ok: true; purchaseId: string }
  | { ok: false; reason: "no_credits" | "job_not_found" | "error"; message: string };

/**
 * Spend one credit to unlock a job. Delegates to the spend_credit() database
 * function, which takes a row lock on the order so two tabs cannot both spend
 * the last credit, and which is idempotent for an already-unlocked job.
 */
export async function spendCredit(
  supabase: SupabaseClient,
  jobId: string
): Promise<SpendResult> {
  const { data, error } = await supabase.rpc("spend_credit", {
    p_job_id: jobId,
  });

  if (!error) return { ok: true, purchaseId: data as string };

  // The function signals with raise exception; Postgres puts the message on
  // error.message. Match on the exact sentinels it raises.
  const raw = error.message ?? "";
  if (raw.includes("no_credits")) {
    return {
      ok: false,
      reason: "no_credits",
      message: "You have no unlock credits left.",
    };
  }
  if (raw.includes("job_not_found")) {
    return { ok: false, reason: "job_not_found", message: "Job not found." };
  }
  console.error("[credits] spend failed:", error);
  return {
    ok: false,
    reason: "error",
    message: "We could not apply your credit. Please try again in a moment.",
  };
}

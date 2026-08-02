import type { SupabaseClient } from "@supabase/supabase-js";
import { PackTier, isPackTier } from "@/lib/packs";
import {
  CreditBalance,
  CreditOrder,
  EMPTY_BALANCE,
  orderUpgradeCents,
} from "@/lib/credit-types";

export { EMPTY_BALANCE, orderUpgradeCents };
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
  tier: string;
  credits_total: number;
  created_at: string;
};

export async function readCreditBalance(
  supabase: SupabaseClient,
  userId: string
): Promise<CreditBalance> {
  const { data: orderRows, error } = await supabase
    .from("orders")
    .select("id, sku, tier, credits_total, created_at")
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

  const byTier: Record<PackTier, number> = { match: 0, full: 0 };
  let nextTier: PackTier | null = null;

  const detailed: CreditOrder[] = orders.map((o) => {
    const tier: PackTier = isPackTier(o.tier) ? o.tier : "match";
    const used = usedBy.get(o.id) ?? 0;
    const left = Math.max(0, o.credits_total - used);
    byTier[tier] += left;
    if (left > 0 && nextTier === null) nextTier = tier;
    return {
      id: o.id,
      sku: o.sku,
      tier,
      creditsTotal: o.credits_total,
      creditsUsed: used,
      creditsLeft: left,
      createdAt: o.created_at,
      upgradeCents: tier === "match" ? orderUpgradeCents(o.credits_total) : 0,
    };
  });

  return {
    total: byTier.match + byTier.full,
    byTier,
    nextTier,
    orders: detailed,
  };
}

/* ------------------------------------------------------------------ */
/* Whole-order upgrade                                                 */
/* ------------------------------------------------------------------ */

/**
 * Lift a paid `match` order to `full` — the entire order, including the jobs
 * whose credits were already spent.
 *
 * The second UPDATE is the whole retroactive-unlock feature. The interview
 * simulation is generated and stored for EVERY tier and merely rendered
 * blurred (`simLocked` in jobs/[id]/workspace.tsx is `purchase.tier ===
 * "match"`), so flipping the tier on the already-minted purchases reveals the
 * reports the user has been looking at, with no LLM call and no new generation
 * rows.
 *
 * Requires a service-role client: `orders` is read-only under RLS, on purpose.
 * Idempotent — a webhook redelivery re-runs both updates to the same values.
 */
export async function applyOrderUpgrade(
  admin: SupabaseClient,
  orderId: string,
  paid: { amountCents: number; providerRef: string | null }
): Promise<{ ok: boolean; error?: string }> {
  const { error: orderError } = await admin
    .from("orders")
    .update({
      tier: "full",
      upgrade_amount_cents: paid.amountCents,
      upgrade_provider_ref: paid.providerRef,
    })
    .eq("id", orderId);
  if (orderError) {
    console.error("[credits] order upgrade failed:", orderError);
    return { ok: false, error: orderError.message };
  }

  const { error: purchaseError } = await admin
    .from("purchases")
    .update({ tier: "full" })
    .eq("order_id", orderId);
  if (purchaseError) {
    // The order is already `full`, so new spends get Full — but the jobs
    // already unlocked stay locked out of their reports. Loud, because it
    // needs a manual fix rather than a retry.
    console.error(
      "[credits] order upgraded but purchases cascade failed:",
      purchaseError
    );
    return { ok: false, error: purchaseError.message };
  }
  return { ok: true };
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

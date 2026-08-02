import { PackQuantity, isPackQuantity, packUpgradeCents } from "@/lib/packs";

/**
 * The credit shapes, with no data access attached.
 *
 * Split out of credits.ts on purpose: that module reaches for a Supabase
 * client, and both the client components (the balance hook, the paywall) and
 * the server routes need these types. Keeping them here means a client bundle
 * never pulls server data-access code in behind a type import.
 */

export type PackTierName = "match" | "full";

export type CreditOrder = {
  id: string;
  sku: string;
  tier: PackTierName;
  creditsTotal: number;
  creditsUsed: number;
  creditsLeft: number;
  createdAt: string;
  /** Cost of lifting this whole order match → full, in cents. 0 when already full. */
  upgradeCents: number;
};

export type CreditBalance = {
  /** Credits left across every paid order. */
  total: number;
  byTier: Record<PackTierName, number>;
  /**
   * The tier the NEXT spend will draw from. Spending is FIFO across orders
   * (oldest paid order first) — see spend_credit() in migration 0010 — so this
   * is the tier of the oldest order that still has a credit left.
   */
  nextTier: PackTierName | null;
  orders: CreditOrder[];
};

export const EMPTY_BALANCE: CreditBalance = {
  total: 0,
  byTier: { match: 0, full: 0 },
  nextTier: null,
  orders: [],
};

/**
 * What lifting a whole order to Full costs. The check constraint bounds
 * credits_total to 1..5, so the fallback is unreachable in practice — it exists
 * so a future pack size cannot crash the balance read before the matrix is
 * updated to cover it.
 */
export function orderUpgradeCents(creditsTotal: number): number {
  return isPackQuantity(creditsTotal)
    ? packUpgradeCents(creditsTotal as PackQuantity)
    : packUpgradeCents(5);
}

/** Orders that can still be lifted to Full Prep. */
export function upgradableOrders(balance: CreditBalance): CreditOrder[] {
  return balance.orders.filter((o) => o.tier === "match");
}

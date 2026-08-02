import { TIERS } from "@/lib/types";

/**
 * Volume pricing — buy N unlocks at once, spend them on jobs whenever.
 *
 * A pack grants CREDITS, not access: paying mints an `orders` row, and each
 * credit spent later mints the ordinary per-job `purchases` row the rest of the
 * app already understands (see migration 0010). Nothing here changes what a
 * single unlock costs — TIERS in types.ts stays the source of truth for that,
 * and every list price below is derived from it.
 *
 * The matrix is deliberately aggressive: this is market-penetration pricing,
 * not margin optimization. Five tailored CVs for $10 is $2 each against a $4
 * single unlock.
 */

export type PackTier = "match" | "full";
export type PackQuantity = 1 | 2 | 3 | 4 | 5;

export const MAX_PACK_SIZE = 5;
export const PACK_QUANTITIES: PackQuantity[] = [1, 2, 3, 4, 5];
/** Bundles are offered for these tiers only; `base` is hidden product-wide. */
export const PACK_TIERS: PackTier[] = ["match", "full"];

/** What the user actually pays, in cents. */
export const PACK_PRICE_CENTS: Record<PackTier, Record<PackQuantity, number>> = {
  match: { 1: 300, 2: 500, 3: 600, 4: 700, 5: 800 },
  full: { 1: 400, 2: 600, 3: 800, 4: 900, 5: 1000 },
};

/**
 * Whole-order match → full upgrade, keyed by pack size.
 *
 * Invariant, checked by packUpgradeCents below: for every quantity,
 * `PACK_PRICE_CENTS.match[q] + PACK_UPGRADE_CENTS[q] === PACK_PRICE_CENTS.full[q]`.
 * A user who buys Basic and upgrades must never pay more than buying Full
 * outright, or the upgrade is a trap.
 */
export const PACK_UPGRADE_CENTS: Record<PackQuantity, number> = {
  1: 100,
  2: 100,
  3: 200,
  4: 200,
  5: 200,
};

export function isPackTier(v: unknown): v is PackTier {
  return v === "match" || v === "full";
}

export function isPackQuantity(v: unknown): v is PackQuantity {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_PACK_SIZE;
}

export function packPriceCents(tier: PackTier, qty: PackQuantity): number {
  return PACK_PRICE_CENTS[tier][qty];
}

/**
 * The struck-through anchor: what these unlocks would cost one at a time.
 * Derived from TIERS so it can never drift from the real single-unit price.
 * Equal to the pack price at qty 1 — the UI must not render a strikethrough
 * then, which is what packHasDiscount is for.
 */
export function packListCents(tier: PackTier, qty: PackQuantity): number {
  return TIERS[tier].priceCents * qty;
}

export function packHasDiscount(tier: PackTier, qty: PackQuantity): boolean {
  return packListCents(tier, qty) > packPriceCents(tier, qty);
}

export function packSavingCents(tier: PackTier, qty: PackQuantity): number {
  return Math.max(0, packListCents(tier, qty) - packPriceCents(tier, qty));
}

/** Rounded whole-percent saving, for the "Save 47%" badge. */
export function packSavingPct(tier: PackTier, qty: PackQuantity): number {
  const list = packListCents(tier, qty);
  if (list <= 0) return 0;
  return Math.round((packSavingCents(tier, qty) / list) * 100);
}

export function packUpgradeCents(qty: PackQuantity): number {
  return PACK_UPGRADE_CENTS[qty];
}

export function centsToUsd(cents: number): string {
  // Every price in the matrix is a whole dollar; keep it that way in the UI
  // rather than shipping "$8.00".
  return cents % 100 === 0 ? `${cents / 100}` : (cents / 100).toFixed(2);
}

/* ------------------------------------------------------------------ */
/* SKUs — the stable id a checkout and its webhook agree on            */
/* ------------------------------------------------------------------ */

/** e.g. "match_x5". Also the key of the Lemon Squeezy variant env map. */
export function packSku(tier: PackTier, qty: PackQuantity): string {
  return `${tier}_x${qty}`;
}

/**
 * Upgrade SKUs are keyed by PRICE, not by pack size: the matrix has five pack
 * sizes but only two upgrade prices, so this is two Lemon Squeezy variants
 * instead of five. The single-job $1 upgrade lands on the same `upgrade_100`
 * variant the 1- and 2-packs use.
 */
export function upgradeSkuFromCents(cents: number): string {
  return `upgrade_${cents}`;
}

export function upgradeSku(qty: PackQuantity): string {
  return upgradeSkuFromCents(packUpgradeCents(qty));
}

export function parsePackSku(
  sku: string
): { tier: PackTier; qty: PackQuantity } | null {
  const m = /^(match|full)_x([1-5])$/.exec(sku);
  if (!m) return null;
  const qty = Number(m[2]);
  if (!isPackQuantity(qty)) return null;
  return { tier: m[1] as PackTier, qty };
}

/** Human label for a pack, used in checkout copy and receipts. */
export function packName(tier: PackTier, qty: PackQuantity): string {
  const base = TIERS[tier].name;
  return qty === 1 ? base : `${base} — ${qty}-pack`;
}

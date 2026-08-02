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
 * Quantity is the ONLY axis. This used to be a tier × quantity matrix, with a
 * cheaper row that bought the CV without the interview report; every purchase
 * now includes every document, so there is one row left (see TIERS).
 *
 * The matrix is deliberately aggressive: this is market-penetration pricing,
 * not margin optimization. Five tailored CVs for $10 is $2 each against a $4
 * single unlock.
 */

export type PackQuantity = 1 | 2 | 3 | 4 | 5;

export const MAX_PACK_SIZE = 5;
export const PACK_QUANTITIES: PackQuantity[] = [1, 2, 3, 4, 5];

/** What the user actually pays, in cents. */
export const PACK_PRICE_CENTS: Record<PackQuantity, number> = {
  1: 400,
  2: 600,
  3: 800,
  4: 900,
  5: 1000,
};

export function isPackQuantity(v: unknown): v is PackQuantity {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= MAX_PACK_SIZE;
}

export function packPriceCents(qty: PackQuantity): number {
  return PACK_PRICE_CENTS[qty];
}

/**
 * The struck-through anchor: what these unlocks would cost one at a time.
 * Derived from TIERS so it can never drift from the real single-unit price.
 * Equal to the pack price at qty 1 — the UI must not render a strikethrough
 * then, which is what packHasDiscount is for.
 */
export function packListCents(qty: PackQuantity): number {
  return TIERS.full.priceCents * qty;
}

export function packHasDiscount(qty: PackQuantity): boolean {
  return packListCents(qty) > packPriceCents(qty);
}

export function packSavingCents(qty: PackQuantity): number {
  return Math.max(0, packListCents(qty) - packPriceCents(qty));
}

/** Rounded whole-percent saving, for the "Save 47%" badge. */
export function packSavingPct(qty: PackQuantity): number {
  const list = packListCents(qty);
  if (list <= 0) return 0;
  return Math.round((packSavingCents(qty) / list) * 100);
}

export function centsToUsd(cents: number): string {
  // Every price in the matrix is a whole dollar; keep it that way in the UI
  // rather than shipping "$8.00".
  return cents % 100 === 0 ? `${cents / 100}` : (cents / 100).toFixed(2);
}

/* ------------------------------------------------------------------ */
/* SKUs — the stable id a checkout and its webhook agree on            */
/* ------------------------------------------------------------------ */

/**
 * e.g. "full_x5". Also the key of the Lemon Squeezy variant env map.
 *
 * The `full_` prefix is kept now that there is only one tier: it is what the
 * configured Lemon Squeezy variant env names and every historical `orders.sku`
 * already say, and renaming it would orphan both.
 */
export function packSku(qty: PackQuantity): string {
  return `full_x${qty}`;
}

/** Human label for a pack, used in checkout copy and receipts. */
export function packName(qty: PackQuantity): string {
  const base = TIERS.full.name;
  return qty === 1 ? base : `${base} — ${qty}-pack`;
}

import { readJson } from "./fetch-json";
import type { TierId } from "./types";
import type { PackQuantity, PackTier } from "./packs";

/**
 * Starts a hosted checkout for a job and hands the browser over to it.
 *
 * Shared by the job workspace and the History upsell so there is one
 * implementation of "buy this tier". The server decides what to actually
 * charge — a `full` checkout on a job that already holds a paid `match` is
 * detected there and billed as the $1 difference (see
 * src/app/api/payments/checkout/route.ts) — so callers only name the tier they
 * want, never a price.
 *
 * Never resolves on success: the caller's loading state should stay up until
 * the navigation replaces the page. Throws with a user-showable message
 * otherwise, so the caller can clear its own busy flag.
 */
export async function startCheckout(
  jobId: string,
  tier: TierId
): Promise<never> {
  return postCheckout({ jobId, tier });
}

/**
 * Buy a bundle of credits — N unlocks at the volume price, spendable on any
 * job later (src/lib/packs.ts holds the matrix). `returnTo` is where checkout
 * comes back to; the server rejects anything that isn't a same-origin
 * relative path.
 */
export async function startPackCheckout(
  tier: PackTier,
  quantity: PackQuantity,
  returnTo?: string
): Promise<never> {
  return postCheckout({ kind: "pack", tier, quantity, returnTo });
}

/**
 * Lift a whole paid bundle from Job Match to Full Prep. Unlocks the interview
 * report on every job already bought with that bundle's credits, and turns the
 * unspent ones into Full credits.
 */
export async function startOrderUpgradeCheckout(
  orderId: string,
  returnTo?: string
): Promise<never> {
  return postCheckout({ kind: "order_upgrade", orderId, returnTo });
}

async function postCheckout(body: Record<string, unknown>): Promise<never> {
  const res = await fetch("/api/payments/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(res);
  if (!res.ok || !data?.url) {
    throw new Error(data?.error ?? "Checkout failed");
  }
  window.location.href = data.url;
  // The assignment above navigates away, but it does not suspend this frame —
  // returning would let the caller flip its button back to idle for the split
  // second before the unload, which looks like the click failed.
  return new Promise<never>(() => {});
}

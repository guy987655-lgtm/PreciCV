import { readJson } from "./fetch-json";
import type { PackQuantity } from "./packs";

/**
 * Starts a hosted checkout for a job and hands the browser over to it.
 *
 * Shared by the job workspace and the History upsell so there is one
 * implementation of "buy this job". There is nothing to choose: one product,
 * one price, and the server is what decides the amount (see
 * src/app/api/payments/checkout/route.ts) — callers never name a price.
 *
 * Never resolves on success: the caller's loading state should stay up until
 * the navigation replaces the page. Throws with a user-showable message
 * otherwise, so the caller can clear its own busy flag.
 */
export async function startCheckout(jobId: string): Promise<never> {
  return postCheckout({ jobId });
}

/**
 * Buy a bundle of credits — N unlocks at the volume price, spendable on any
 * job later (src/lib/packs.ts holds the price table). `returnTo` is where
 * checkout comes back to; the server rejects anything that isn't a same-origin
 * relative path.
 */
export async function startPackCheckout(
  quantity: PackQuantity,
  returnTo?: string
): Promise<never> {
  return postCheckout({ kind: "pack", quantity, returnTo });
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

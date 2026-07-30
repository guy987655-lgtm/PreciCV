import { readJson } from "./fetch-json";
import type { TierId } from "./types";

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
  const res = await fetch("/api/payments/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, tier }),
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

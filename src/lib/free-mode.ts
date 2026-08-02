/**
 * Temporary "everything is free" switch, in force until Lemon Squeezy approves
 * the store and we can actually charge.
 *
 * It does NOT tear the paywall out. The card still renders, the credit ledger
 * still works — the checkout simply grants the purchase on the spot instead of
 * sending the user to Lemon Squeezy, and the price is relabelled. Everything
 * downstream (the 402 in /api/generate, the is_sample locks on editing, export
 * and reports, the run-page tier) keys off a paid `purchases` row, so all of it
 * unlocks on its own once that row exists.
 *
 * Turning it off is one env var plus a deploy: the real payment path, the
 * webhook and its signature check were never touched.
 *
 * NEXT_PUBLIC_ because the paywall copy reads it in the browser. That also
 * means the value is inlined at build time and a change needs a redeploy —
 * deliberate: there is no way to flip this on or off at runtime by accident.
 *
 * Deliberately its own module rather than a function in lemonsqueezy.ts, which
 * imports `crypto` at the top level and would drag it into the client bundle.
 */
export function freeMode(): boolean {
  return process.env.NEXT_PUBLIC_FREE_MODE === "true";
}

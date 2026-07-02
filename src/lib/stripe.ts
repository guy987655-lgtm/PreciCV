import Stripe from "stripe";

export function stripeClient() {
  return new Stripe(process.env.STRIPE_SECRET_KEY!);
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * When true (and Stripe is not configured), purchases are granted without
 * payment so the product can be tested end-to-end before Stripe is wired up.
 * Never enable in production.
 */
export function devFreeMode(): boolean {
  return process.env.DEV_FREE_MODE === "true";
}

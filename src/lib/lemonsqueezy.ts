import { createHmac, timingSafeEqual } from "crypto";
import type { TierId } from "@/lib/types";

/**
 * Lemon Squeezy — Merchant of Record. Replaces the old Stripe layer (Stripe
 * has no Israeli merchant onboarding). MoR means Lemon Squeezy is the seller
 * of record and handles global VAT/sales tax for us.
 *
 * Thin `fetch`-based client over the REST API (https://docs.lemonsqueezy.com):
 * one POST creates a hosted checkout; the webhook flips the purchase to paid.
 * Prices live in the Lemon Squeezy dashboard as one variant per tier; the
 * `LEMONSQUEEZY_VARIANT_*` env vars map our tiers to those variant ids.
 */

const LS_API = "https://api.lemonsqueezy.com/v1";

export function lsConfigured(): boolean {
  return Boolean(
    process.env.LEMONSQUEEZY_API_KEY && process.env.LEMONSQUEEZY_STORE_ID
  );
}

/**
 * When true (and Lemon Squeezy is not configured), purchases are granted
 * without payment so the product can be tested end-to-end before the store is
 * wired up. Never enable in production.
 */
export function devFreeMode(): boolean {
  return process.env.DEV_FREE_MODE === "true";
}

/** Resolve the Lemon Squeezy variant id for a checkout. Upgrades use the
 *  dedicated +$1 variant; everything else uses the tier's own variant. */
function variantForTier(tier: TierId, isUpgrade: boolean): string | undefined {
  if (isUpgrade) return process.env.LEMONSQUEEZY_VARIANT_UPGRADE;
  const map: Partial<Record<TierId, string | undefined>> = {
    match: process.env.LEMONSQUEEZY_VARIANT_MATCH,
    full: process.env.LEMONSQUEEZY_VARIANT_FULL,
  };
  return map[tier];
}

const LS_HEADERS = () => ({
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
  Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
});

/**
 * Creates a hosted Lemon Squeezy checkout and returns its URL. `custom` is
 * echoed back verbatim on the order webhook (`meta.custom_data`), so we pass
 * the ids we need to mark the purchase paid.
 */
export async function createLsCheckout(opts: {
  tier: TierId;
  isUpgrade: boolean;
  email: string | undefined;
  userId: string;
  jobId: string;
  redirectUrl: string;
}): Promise<string> {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID!;
  const variantId = variantForTier(opts.tier, opts.isUpgrade);
  if (!variantId) {
    throw new Error(
      `No Lemon Squeezy variant configured for ${
        opts.isUpgrade ? "upgrade" : opts.tier
      }`
    );
  }

  const res = await fetch(`${LS_API}/checkouts`, {
    method: "POST",
    headers: LS_HEADERS(),
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: opts.email,
            // Lemon Squeezy requires custom values to be strings.
            custom: {
              user_id: opts.userId,
              job_id: opts.jobId,
              tier: opts.tier,
            },
          },
          product_options: { redirect_url: opts.redirectUrl },
        },
        relationships: {
          store: { data: { type: "stores", id: storeId } },
          variant: { data: { type: "variants", id: variantId } },
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Lemon Squeezy checkout failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as {
    data?: { id?: string; attributes?: { url?: string } };
  };
  const url = json.data?.attributes?.url;
  if (!url) throw new Error("Lemon Squeezy checkout returned no URL");
  return url;
}

/**
 * Verifies a Lemon Squeezy webhook. LS signs the raw request body with
 * HMAC-SHA256 using the store's signing secret and sends it hex-encoded in the
 * `X-Signature` header. Compared in constant time.
 */
export function verifyLsWebhook(
  rawBody: string,
  signature: string | null
): boolean {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

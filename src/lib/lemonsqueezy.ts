import { createHmac, timingSafeEqual } from "crypto";

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

/**
 * SKU → the env var holding its Lemon Squeezy variant id.
 *
 * One variant per PRICE, because Lemon Squeezy variants carry their price in
 * the dashboard. The volume matrix in src/lib/packs.ts has ten pack prices,
 * and upgrades are keyed by price rather than pack size (five pack sizes, two
 * upgrade prices) — twelve variants in total, of which three already exist and
 * keep their original env var names so nothing has to be re-entered.
 *
 * If Lemon Squeezy's `checkout_data.custom_price` turns out to be available on
 * this store, this whole map collapses to two variants priced per checkout —
 * that change is confined to this one function.
 */
const VARIANT_ENV: Record<string, string> = {
  // Singles — the original three, unchanged.
  match_x1: "LEMONSQUEEZY_VARIANT_MATCH",
  full_x1: "LEMONSQUEEZY_VARIANT_FULL",
  upgrade_100: "LEMONSQUEEZY_VARIANT_UPGRADE",
  // Packs.
  match_x2: "LEMONSQUEEZY_VARIANT_MATCH_X2",
  match_x3: "LEMONSQUEEZY_VARIANT_MATCH_X3",
  match_x4: "LEMONSQUEEZY_VARIANT_MATCH_X4",
  match_x5: "LEMONSQUEEZY_VARIANT_MATCH_X5",
  full_x2: "LEMONSQUEEZY_VARIANT_FULL_X2",
  full_x3: "LEMONSQUEEZY_VARIANT_FULL_X3",
  full_x4: "LEMONSQUEEZY_VARIANT_FULL_X4",
  full_x5: "LEMONSQUEEZY_VARIANT_FULL_X5",
  // The $2 whole-order upgrade (3-, 4- and 5-packs).
  upgrade_200: "LEMONSQUEEZY_VARIANT_UPGRADE_2",
};

/** Resolve the Lemon Squeezy variant id for a SKU (see src/lib/packs.ts). */
export function variantForSku(sku: string): string | undefined {
  const envName = VARIANT_ENV[sku];
  return envName ? process.env[envName] : undefined;
}

/** Which SKUs have no variant configured — surfaced by the checkout route so a
 *  missing env var fails with a nameable cause instead of a generic 500. */
export function missingVariantSkus(): string[] {
  return Object.keys(VARIANT_ENV).filter((sku) => !variantForSku(sku));
}

const LS_HEADERS = () => ({
  Accept: "application/vnd.api+json",
  "Content-Type": "application/vnd.api+json",
  Authorization: `Bearer ${process.env.LEMONSQUEEZY_API_KEY}`,
});

/**
 * Creates a hosted Lemon Squeezy checkout and returns its URL. `custom` is
 * echoed back verbatim on the order webhook (`meta.custom_data`), so it carries
 * the ids the webhook needs to grant what was bought:
 *
 *   single job unlock → { user_id, job_id, tier }
 *   credit bundle     → { user_id, order_id, sku }
 *
 * The webhook branches on which of `job_id` / `order_id` is present.
 */
export async function createLsCheckout(opts: {
  sku: string;
  email: string | undefined;
  /** Lemon Squeezy requires every custom value to be a string. */
  custom: Record<string, string>;
  redirectUrl: string;
}): Promise<string> {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID!;
  const variantId = variantForSku(opts.sku);
  if (!variantId) {
    throw new Error(`No Lemon Squeezy variant configured for ${opts.sku}`);
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
            custom: opts.custom,
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

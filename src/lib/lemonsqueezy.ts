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
 * OPTIONAL, all of it apart from full_x1. `custom_price` is supported on this
 * store (verified against the live API: a checkout created on the $4 Full Prep
 * variant with `custom_price: 800` renders $8.00), so every pack SKU falls back
 * to the single-unlock variant priced per checkout — see resolveVariant.
 * Without that fallback, four of these five SKUs were unset and every
 * multi-job checkout 503'd with "isn't available for purchase yet".
 *
 * An id set here still WINS. Creating a real dashboard variant for a pack is
 * therefore a pure config change: fill in the env var and that SKU stops using
 * a custom price, with its dashboard name and price taking over.
 */
const VARIANT_ENV: Record<string, string> = {
  // The single unlock, sold at the variant's own dashboard price ($4).
  full_x1: "LEMONSQUEEZY_VARIANT_FULL",
  // Packs.
  full_x2: "LEMONSQUEEZY_VARIANT_FULL_X2",
  full_x3: "LEMONSQUEEZY_VARIANT_FULL_X3",
  full_x4: "LEMONSQUEEZY_VARIANT_FULL_X4",
  full_x5: "LEMONSQUEEZY_VARIANT_FULL_X5",
};

/**
 * The variant a SKU falls back to when it has none of its own: the single
 * unlock, sold at whatever price the checkout carries. `full_x4` rides the
 * Full Prep variant with a custom price.
 *
 * One entry, because there is one product. The old `match` and `upgrade`
 * families disappeared with the second tier.
 */
const BASE_VARIANT_ENV: Record<string, string> = {
  full: "LEMONSQUEEZY_VARIANT_FULL",
};

/** Resolve the Lemon Squeezy variant id for a SKU (see src/lib/packs.ts). */
export function variantForSku(sku: string): string | undefined {
  const envName = VARIANT_ENV[sku];
  return envName ? process.env[envName] : undefined;
}

/**
 * Which variant to sell a SKU on, and whether the price has to travel with the
 * checkout. `custom: true` means the variant's dashboard price is NOT the
 * price being charged — createLsCheckout must send `custom_price` and refuse
 * to return a URL unless Lemon Squeezy confirms it took the number.
 */
export function resolveVariant(
  sku: string
): { id: string; custom: boolean } | undefined {
  const exact = variantForSku(sku);
  if (exact) return { id: exact, custom: false };
  const envName = BASE_VARIANT_ENV[sku.split("_")[0]];
  const base = envName ? process.env[envName] : undefined;
  return base ? { id: base, custom: true } : undefined;
}

/** Which SKUs have no variant configured — surfaced by the checkout route so a
 *  missing env var fails with a nameable cause instead of a generic 500. */
export function missingVariantSkus(): string[] {
  return Object.keys(VARIANT_ENV).filter((sku) => !resolveVariant(sku));
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
 *   single job unlock → { user_id, job_id }
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
  /** What this SKU costs, per the app's own pricing (src/lib/packs.ts). Sent
   *  as the checkout's price whenever the SKU has no variant of its own. */
  amountCents: number;
  /** Product name and blurb on the hosted page. Only used with a custom price
   *  — a dedicated variant already carries its own, set in the dashboard. */
  label?: string;
  description?: string;
}): Promise<string> {
  const storeId = process.env.LEMONSQUEEZY_STORE_ID!;
  const variant = resolveVariant(opts.sku);
  if (!variant) {
    throw new Error(`No Lemon Squeezy variant configured for ${opts.sku}`);
  }

  const res = await fetch(`${LS_API}/checkouts`, {
    method: "POST",
    headers: LS_HEADERS(),
    body: JSON.stringify({
      data: {
        type: "checkouts",
        attributes: {
          // `custom_price` is a checkout attribute, NOT part of checkout_data.
          ...(variant.custom ? { custom_price: opts.amountCents } : {}),
          checkout_data: {
            email: opts.email,
            custom: opts.custom,
          },
          product_options: {
            redirect_url: opts.redirectUrl,
            // Otherwise a 5-pack would be titled "Job Match" on the payment
            // page, because it is riding the single-unlock variant.
            ...(variant.custom && opts.label ? { name: opts.label } : {}),
            ...(variant.custom && opts.description
              ? { description: opts.description }
              : {}),
          },
        },
        relationships: {
          store: { data: { type: "stores", id: storeId } },
          variant: { data: { type: "variants", id: variant.id } },
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Lemon Squeezy checkout failed (${res.status}): ${detail}`);
  }

  const json = (await res.json()) as {
    data?: { id?: string; attributes?: { url?: string; custom_price?: number } };
  };
  /**
   * Never hand back a URL at a price we did not set. If a plan or product type
   * ever ignores `custom_price`, the checkout would silently fall back to the
   * single-unlock price — a 5-pack sold for $3. Failing here surfaces as the
   * ordinary "couldn't start checkout" message instead of undercharging.
   */
  if (
    variant.custom &&
    json.data?.attributes?.custom_price !== opts.amountCents
  ) {
    throw new Error(
      `Lemon Squeezy ignored the custom price for ${opts.sku} ` +
        `(sent ${opts.amountCents}, got ${json.data?.attributes?.custom_price})`
    );
  }
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

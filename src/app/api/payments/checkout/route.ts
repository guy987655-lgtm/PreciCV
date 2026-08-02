import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createLsCheckout,
  devFreeMode,
  lsConfigured,
} from "@/lib/lemonsqueezy";
import { TIERS, TierId } from "@/lib/types";
import {
  PackQuantity,
  isPackQuantity,
  isPackTier,
  packName,
  packPriceCents,
  packSku,
  upgradeSkuFromCents,
} from "@/lib/packs";
import { applyOrderUpgrade, orderUpgradeCents } from "@/lib/credits";

/**
 * Three things can be bought:
 *
 *   single         { jobId, tier }                — one job unlock, as always
 *   pack           { kind: 'pack', tier, quantity } — N credits, spent later
 *   order_upgrade  { kind: 'order_upgrade', orderId } — lift a pack to Full
 *
 * The single shape is unchanged and carries no `kind`, so every existing
 * caller (startCheckout in src/lib/checkout.ts) keeps working untouched.
 */
const SingleSchema = z.object({
  jobId: z.string().uuid(),
  tier: z.enum(["base", "match", "full"]),
});
const PackSchema = z.object({
  kind: z.literal("pack"),
  tier: z.enum(["match", "full"]),
  quantity: z.number().int().min(1).max(5),
  /** Where to come back to after paying. Same-origin relative path only. */
  returnTo: z.string().optional(),
});
const OrderUpgradeSchema = z.object({
  kind: z.literal("order_upgrade"),
  orderId: z.string().uuid(),
  returnTo: z.string().optional(),
});
const BodySchema = z.union([PackSchema, OrderUpgradeSchema, SingleSchema]);

/** Relative same-origin paths only — this value ends up in a redirect URL. */
function safeReturnTo(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  return value;
}

function withPaidFlag(path: string): string {
  return path.includes("?") ? `${path}&paid=1` : `${path}?paid=1`;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const body = parsed.data;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  if ("kind" in body && body.kind === "pack") {
    return packCheckout(supabase, user, body, appUrl);
  }
  if ("kind" in body && body.kind === "order_upgrade") {
    return orderUpgradeCheckout(supabase, user, body, appUrl);
  }
  return singleCheckout(supabase, user, body, appUrl);
}

type SessionUser = { id: string; email?: string };

/* ------------------------------------------------------------------ */
/* Single job unlock — unchanged behaviour                             */
/* ------------------------------------------------------------------ */

/**
 * Creates a Lemon Squeezy checkout for a single job purchase
 * (Job Match $3 / Full Prep $4). One purchase per job_id.
 *
 * Upgrade path: a job that already has a paid `match` purchase may buy `full`
 * for the $1 difference. The existing row is updated in place (never
 * downgraded to pending), so `match` access is kept while the upgrade is
 * pending; the webhook flips its tier to `full`.
 */
async function singleCheckout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: SessionUser,
  body: z.infer<typeof SingleSchema>,
  appUrl: string
) {
  const { jobId, tier } = body;
  const tierInfo = TIERS[tier as TierId];

  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("id", jobId)
    .eq("user_id", user.id)
    .single();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("purchases")
    .select("id, tier, status")
    .eq("job_id", jobId)
    .eq("status", "paid")
    .maybeSingle();

  // A paid `match` buying `full` is an upgrade (charge only the difference);
  // any other purchase on an already-paid job is rejected.
  const isUpgrade =
    Boolean(existing) && existing!.tier === "match" && tier === "full";
  if (existing && !isUpgrade) {
    return NextResponse.json(
      { error: "This job already has a paid purchase" },
      { status: 409 }
    );
  }

  const upgradeCents = TIERS.full.priceCents - TIERS.match.priceCents;
  const amountCents = isUpgrade ? upgradeCents : tierInfo.priceCents;

  // Local testing path before Lemon Squeezy is configured.
  if (!lsConfigured() && devFreeMode()) {
    await supabase.from("purchases").upsert(
      {
        user_id: user.id,
        job_id: jobId,
        tier,
        status: "paid",
        amount_cents: 0,
        revisions_used: 0,
      },
      { onConflict: "job_id" }
    );
    return NextResponse.json({ url: `${appUrl}/jobs/${jobId}?paid=dev` });
  }
  if (!lsConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured yet (missing LEMONSQUEEZY_API_KEY)" },
      { status: 503 }
    );
  }

  // The $1 difference is its own variant, keyed by price like every other
  // upgrade SKU; a single unlock is the 1-pack of its tier. `base` has never
  // had a variant (it is hidden from the UI), so it resolves to a SKU with no
  // configured variant and fails below with a nameable reason.
  const sku = isUpgrade
    ? upgradeSkuFromCents(upgradeCents)
    : isPackTier(tier)
      ? packSku(tier, 1)
      : `${tier}_x1`;

  let url: string;
  try {
    url = await createLsCheckout({
      sku,
      email: user.email,
      custom: { user_id: user.id, job_id: jobId, tier },
      redirectUrl: `${appUrl}/jobs/${jobId}?paid=1`,
    });
  } catch (e) {
    return checkoutFailure(e, sku);
  }

  // Fresh purchases get a pending row the webhook flips to 'paid'. Upgrades
  // leave the existing paid `match` row untouched (don't drop the user's
  // access if they abandon the upgrade); the webhook raises it to `full`.
  if (!isUpgrade) {
    await supabase.from("purchases").upsert(
      {
        user_id: user.id,
        job_id: jobId,
        tier,
        status: "pending",
        amount_cents: amountCents,
        revisions_used: 0,
      },
      { onConflict: "job_id" }
    );
  }

  return NextResponse.json({ url });
}

/* ------------------------------------------------------------------ */
/* Credit pack                                                         */
/* ------------------------------------------------------------------ */

async function packCheckout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: SessionUser,
  body: z.infer<typeof PackSchema>,
  appUrl: string
) {
  const { tier, quantity } = body;
  if (!isPackQuantity(quantity)) {
    return NextResponse.json({ error: "Invalid pack size" }, { status: 400 });
  }
  const qty = quantity as PackQuantity;
  const amountCents = packPriceCents(tier, qty);
  const sku = packSku(tier, qty);
  const returnTo = safeReturnTo(body.returnTo, "/my-account");

  // `orders` is read-only under RLS on purpose — a user-writable orders table
  // would let anyone mint themselves credits from the browser. Every write
  // goes through the service role.
  const admin = createAdminClient();

  if (!lsConfigured() && devFreeMode()) {
    const { data: order, error } = await admin
      .from("orders")
      .insert({
        user_id: user.id,
        sku,
        tier,
        credits_total: qty,
        status: "paid",
        amount_cents: 0,
      })
      .select("id")
      .single();
    if (error || !order) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to create order" },
        { status: 500 }
      );
    }
    return NextResponse.json({ url: `${appUrl}${withPaidFlag(returnTo)}` });
  }
  if (!lsConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured yet (missing LEMONSQUEEZY_API_KEY)" },
      { status: 503 }
    );
  }

  // The pending order exists BEFORE the checkout so its id can travel in
  // custom_data; the webhook flips it to paid. An abandoned checkout leaves a
  // pending row, which grants nothing — readCreditBalance only counts 'paid'.
  const { data: order, error } = await admin
    .from("orders")
    .insert({
      user_id: user.id,
      sku,
      tier,
      credits_total: qty,
      status: "pending",
      amount_cents: amountCents,
    })
    .select("id")
    .single();
  if (error || !order) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create order" },
      { status: 500 }
    );
  }

  try {
    const url = await createLsCheckout({
      sku,
      email: user.email,
      custom: { user_id: user.id, order_id: order.id, sku },
      redirectUrl: `${appUrl}${withPaidFlag(returnTo)}`,
    });
    return NextResponse.json({ url, orderId: order.id });
  } catch (e) {
    // Don't leave a pending order behind for a checkout that never existed.
    await admin.from("orders").delete().eq("id", order.id);
    return checkoutFailure(e, sku, packName(tier, qty));
  }
}

/* ------------------------------------------------------------------ */
/* Whole-order upgrade                                                 */
/* ------------------------------------------------------------------ */

async function orderUpgradeCheckout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: SessionUser,
  body: z.infer<typeof OrderUpgradeSchema>,
  appUrl: string
) {
  const { data: order } = await supabase
    .from("orders")
    .select("id, tier, status, credits_total")
    .eq("id", body.orderId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "paid") {
    return NextResponse.json(
      { error: "That order has not been paid for yet" },
      { status: 409 }
    );
  }
  if (order.tier !== "match") {
    return NextResponse.json(
      { error: "That order already includes the interview reports" },
      { status: 409 }
    );
  }

  const amountCents = orderUpgradeCents(order.credits_total);
  const sku = upgradeSkuFromCents(amountCents);
  const returnTo = safeReturnTo(body.returnTo, "/my-account");
  const admin = createAdminClient();

  if (!lsConfigured() && devFreeMode()) {
    const applied = await applyOrderUpgrade(admin, order.id, {
      amountCents: 0,
      providerRef: null,
    });
    if (!applied.ok) {
      return NextResponse.json({ error: applied.error }, { status: 500 });
    }
    return NextResponse.json({ url: `${appUrl}${withPaidFlag(returnTo)}` });
  }
  if (!lsConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured yet (missing LEMONSQUEEZY_API_KEY)" },
      { status: 503 }
    );
  }

  // Nothing is written before payment: the order stays paid at `match`, so an
  // abandoned upgrade costs the user none of the access they already have.
  // Mirrors the single-job upgrade path above.
  try {
    const url = await createLsCheckout({
      sku,
      email: user.email,
      custom: {
        user_id: user.id,
        order_id: order.id,
        sku,
        upgrade: "1",
      },
      redirectUrl: `${appUrl}${withPaidFlag(returnTo)}`,
    });
    return NextResponse.json({ url });
  } catch (e) {
    return checkoutFailure(e, sku);
  }
}

/**
 * A checkout that could not be created is nearly always a variant id that was
 * never added to the environment. Name the SKU so the fix is obvious from the
 * logs instead of surfacing as an unexplained 500.
 */
function checkoutFailure(e: unknown, sku: string, label?: string) {
  console.error(`[api/payments/checkout] ${sku} failed:`, e);
  const message = e instanceof Error ? e.message : "";
  if (message.includes("No Lemon Squeezy variant configured")) {
    return NextResponse.json(
      {
        error: `${label ?? sku} isn't available for purchase yet. Please try a different option.`,
      },
      { status: 503 }
    );
  }
  return NextResponse.json(
    { error: "We couldn't start checkout. Please try again in a moment." },
    { status: 502 }
  );
}

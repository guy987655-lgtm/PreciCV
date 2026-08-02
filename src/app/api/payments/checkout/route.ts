import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createLsCheckout,
  devFreeMode,
  lsConfigured,
} from "@/lib/lemonsqueezy";
import { TIERS } from "@/lib/types";
import {
  PackQuantity,
  isPackQuantity,
  packName,
  packPriceCents,
  packSku,
} from "@/lib/packs";

/**
 * Two things can be bought:
 *
 *   single  { jobId }                      — one job unlock
 *   pack    { kind: 'pack', quantity }     — N credits, spent later
 *
 * Neither names a tier: there is one product (TIERS.full), so the only thing
 * a caller can decide is how many unlocks. The `order_upgrade` shape that used
 * to lift a Job Match bundle to Full Prep is gone with the tier it upgraded
 * from.
 */
const SingleSchema = z.object({
  jobId: z.string().uuid(),
});
const PackSchema = z.object({
  kind: z.literal("pack"),
  quantity: z.number().int().min(1).max(5),
  /** Where to come back to after paying. Same-origin relative path only. */
  returnTo: z.string().optional(),
});
const BodySchema = z.union([PackSchema, SingleSchema]);

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

  // `kind` is what distinguishes the two shapes, and a pack is the only kind.
  if ("kind" in body) {
    return packCheckout(supabase, user, body, appUrl);
  }
  return singleCheckout(supabase, user, body, appUrl);
}

type SessionUser = { id: string; email?: string };

/* ------------------------------------------------------------------ */
/* Single job unlock — unchanged behaviour                             */
/* ------------------------------------------------------------------ */

/**
 * Creates a Lemon Squeezy checkout for a single job purchase (Full Prep, $4).
 * One purchase per job_id, and no upgrade path to speak of — every purchase
 * already includes every document.
 */
async function singleCheckout(
  supabase: Awaited<ReturnType<typeof createClient>>,
  user: SessionUser,
  body: z.infer<typeof SingleSchema>,
  appUrl: string
) {
  const { jobId } = body;
  const tierInfo = TIERS.full;

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
    .select("id, status")
    .eq("job_id", jobId)
    .eq("status", "paid")
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "This job already has a paid purchase" },
      { status: 409 }
    );
  }

  const amountCents = tierInfo.priceCents;

  // Local testing path before Lemon Squeezy is configured.
  if (!lsConfigured() && devFreeMode()) {
    await supabase.from("purchases").upsert(
      {
        user_id: user.id,
        job_id: jobId,
        tier: "full",
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

  // A single unlock is the 1-pack, which is the one SKU that rides the
  // dashboard variant's own price rather than a custom one.
  const sku = packSku(1);

  let url: string;
  try {
    url = await createLsCheckout({
      sku,
      amountCents,
      label: tierInfo.name,
      description: tierInfo.description,
      email: user.email,
      custom: { user_id: user.id, job_id: jobId },
      redirectUrl: `${appUrl}/jobs/${jobId}?paid=1`,
    });
  } catch (e) {
    return checkoutFailure(e, sku);
  }

  // A pending row the webhook flips to 'paid'.
  await supabase.from("purchases").upsert(
    {
      user_id: user.id,
      job_id: jobId,
      tier: "full",
      status: "pending",
      amount_cents: amountCents,
      revisions_used: 0,
    },
    { onConflict: "job_id" }
  );

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
  const { quantity } = body;
  if (!isPackQuantity(quantity)) {
    return NextResponse.json({ error: "Invalid pack size" }, { status: 400 });
  }
  const qty = quantity as PackQuantity;
  const amountCents = packPriceCents(qty);
  const sku = packSku(qty);
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
        tier: "full",
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
      tier: "full",
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
      amountCents,
      label: packName(qty),
      description:
        qty === 1
          ? TIERS.full.description
          : `${qty} unlocks to spend on any jobs — ${TIERS.full.description}`,
      email: user.email,
      custom: { user_id: user.id, order_id: order.id, sku },
      redirectUrl: `${appUrl}${withPaidFlag(returnTo)}`,
    });
    return NextResponse.json({ url, orderId: order.id });
  } catch (e) {
    // Don't leave a pending order behind for a checkout that never existed.
    await admin.from("orders").delete().eq("id", order.id);
    return checkoutFailure(e, sku, packName(qty));
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

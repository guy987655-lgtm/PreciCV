import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyLsWebhook } from "@/lib/lemonsqueezy";
import { applyOrderUpgrade } from "@/lib/credits";

/**
 * Lemon Squeezy webhook — verifies the signature and grants what was bought.
 * Uses the service-role client because there is no user session here. The ids
 * we need travel in `meta.custom_data` (set when the checkout was created),
 * and which ids are present is what says WHAT was bought:
 *
 *   { user_id, job_id, tier }        → one job unlock. For an upgrade the tier
 *                                      is `full`, so the same upsert lifts the
 *                                      existing paid `match` row.
 *   { user_id, order_id, sku }       → a credit bundle; flip the order to paid.
 *   { ..., order_id, upgrade: "1" }  → lift a whole bundle match → full,
 *                                      including the jobs already unlocked
 *                                      from it.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature");
  if (!verifyLsWebhook(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: {
    meta?: {
      event_name?: string;
      custom_data?: {
        user_id?: string;
        job_id?: string;
        tier?: string;
        order_id?: string;
        sku?: string;
        upgrade?: string;
      };
    };
    data?: { id?: string; attributes?: { status?: string; total?: number } };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const eventName = event.meta?.event_name;
  const status = event.data?.attributes?.status;
  if (eventName !== "order_created" || status !== "paid") {
    return NextResponse.json({ received: true });
  }

  const { user_id, job_id, tier, order_id, upgrade } =
    event.meta?.custom_data ?? {};
  const amountCents = event.data?.attributes?.total ?? 0;
  const providerRef = event.data?.id ?? null;
  const admin = createAdminClient();

  // ---- bundle: whole-order upgrade -------------------------------------
  if (user_id && order_id && upgrade === "1") {
    const applied = await applyOrderUpgrade(admin, order_id, {
      amountCents,
      providerRef,
    });
    // 500 asks Lemon Squeezy to redeliver; applyOrderUpgrade is idempotent.
    if (!applied.ok) {
      return NextResponse.json({ error: "upgrade_failed" }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // ---- bundle: credits purchased ---------------------------------------
  if (user_id && order_id) {
    const { error } = await admin
      .from("orders")
      .update({
        status: "paid",
        amount_cents: amountCents,
        provider_ref: providerRef,
      })
      .eq("id", order_id)
      .eq("user_id", user_id);
    if (error) {
      console.error("[payments/webhook] could not mark order paid:", error);
      return NextResponse.json({ error: "order_failed" }, { status: 500 });
    }
    return NextResponse.json({ received: true });
  }

  // ---- single job unlock -----------------------------------------------
  if (user_id && job_id && tier) {
    await admin.from("purchases").upsert(
      {
        user_id,
        job_id,
        tier,
        status: "paid",
        amount_cents: amountCents,
        provider_ref: providerRef,
      },
      { onConflict: "job_id" }
    );
  }

  return NextResponse.json({ received: true });
}

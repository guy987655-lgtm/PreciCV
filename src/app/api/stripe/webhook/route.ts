import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient } from "@/lib/stripe";

/**
 * Stripe webhook — verifies the signature and marks the purchase as paid.
 * Uses the service-role client because there is no user session here.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripeClient().webhooks.constructEventAsync(
      payload,
      signature,
      secret
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { user_id, job_id, tier } = session.metadata ?? {};
    if (user_id && job_id && tier) {
      const admin = createAdminClient();
      await admin.from("purchases").upsert(
        {
          user_id,
          job_id,
          tier,
          status: "paid",
          amount_cents: session.amount_total ?? 0,
          stripe_session_id: session.id,
        },
        { onConflict: "job_id" }
      );
    }
  }

  return NextResponse.json({ received: true });
}

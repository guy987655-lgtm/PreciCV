import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { devFreeMode, stripeClient, stripeConfigured } from "@/lib/stripe";
import { TIERS, TierId } from "@/lib/types";

const BodySchema = z.object({
  jobId: z.string().uuid(),
  tier: z.enum(["base", "match", "full"]),
});

/**
 * Creates a Stripe Checkout session for a single job purchase
 * (Base $2 / Job Match $3 / Full Prep $5). One purchase per job_id.
 */
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
  const { jobId, tier } = parsed.data;
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  // Local testing path before Stripe is configured.
  if (!stripeConfigured() && devFreeMode()) {
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
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: "Payments are not configured yet (missing STRIPE_SECRET_KEY)" },
      { status: 503 }
    );
  }

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: user.email,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: tierInfo.priceCents,
          product_data: {
            name: `PreciCV ${tierInfo.name} — Tailored CV`,
            description: tierInfo.description,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { user_id: user.id, job_id: jobId, tier },
    success_url: `${appUrl}/jobs/${jobId}?paid=1`,
    cancel_url: `${appUrl}/jobs/${jobId}?canceled=1`,
  });

  // Record pending purchase; webhook flips it to 'paid'.
  await supabase.from("purchases").upsert(
    {
      user_id: user.id,
      job_id: jobId,
      tier,
      status: "pending",
      amount_cents: tierInfo.priceCents,
      stripe_session_id: session.id,
      revisions_used: 0,
    },
    { onConflict: "job_id" }
  );

  return NextResponse.json({ url: session.url });
}

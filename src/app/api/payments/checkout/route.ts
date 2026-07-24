import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  createLsCheckout,
  devFreeMode,
  lsConfigured,
} from "@/lib/lemonsqueezy";
import { TIERS, TierId } from "@/lib/types";

const BodySchema = z.object({
  jobId: z.string().uuid(),
  tier: z.enum(["base", "match", "full"]),
});

/**
 * Creates a Lemon Squeezy checkout for a single job purchase
 * (Job Match $3 / Full Prep $4). One purchase per job_id.
 *
 * Upgrade path: a job that already has a paid `match` purchase may buy `full`
 * for the $1 difference. The existing row is updated in place (never
 * downgraded to pending), so `match` access is kept while the upgrade is
 * pending; the webhook flips its tier to `full`.
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

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

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

  const url = await createLsCheckout({
    tier,
    isUpgrade,
    email: user.email,
    userId: user.id,
    jobId,
    redirectUrl: `${appUrl}/jobs/${jobId}?paid=1`,
  });

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

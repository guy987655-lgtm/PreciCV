import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyLsWebhook } from "@/lib/lemonsqueezy";

/**
 * Lemon Squeezy webhook — verifies the signature and marks the purchase paid.
 * Uses the service-role client because there is no user session here. The ids
 * we need travel in `meta.custom_data` (set when the checkout was created).
 *
 * For an upgrade the custom tier is `full`, so the same upsert lifts the
 * existing paid `match` row to `full` and unlocks the interview simulation.
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
      custom_data?: { user_id?: string; job_id?: string; tier?: string };
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
  if (eventName === "order_created" && status === "paid") {
    const { user_id, job_id, tier } = event.meta?.custom_data ?? {};
    if (user_id && job_id && tier) {
      const admin = createAdminClient();
      await admin.from("purchases").upsert(
        {
          user_id,
          job_id,
          tier,
          status: "paid",
          amount_cents: event.data?.attributes?.total ?? 0,
          provider_ref: event.data?.id ?? null,
        },
        { onConflict: "job_id" }
      );
    }
  }

  return NextResponse.json({ received: true });
}

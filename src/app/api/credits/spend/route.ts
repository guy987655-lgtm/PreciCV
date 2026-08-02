import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { readCreditBalance, spendCredit } from "@/lib/credits";

const BodySchema = z.object({ jobId: z.string().uuid() });

/**
 * Spend one bundle credit to unlock a job.
 *
 * This is the credit equivalent of paying at checkout: it mints the ordinary
 * per-job `purchases` row, so afterwards every existing entitlement check —
 * /api/generate, the workspace paywall, the export gate — sees a paid job and
 * behaves exactly as it would after a card payment.
 *
 * The real work happens in the spend_credit() database function (migration
 * 0010), which takes a row lock so two tabs cannot both spend the last credit,
 * and which returns the existing purchase rather than burning a second credit
 * when the job is already unlocked.
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

  const result = await spendCredit(supabase, parsed.data.jobId);
  if (!result.ok) {
    // 402 for "out of credits" so the client can steer to checkout the same
    // way it does for an unpaid job; 404 for a job that isn't theirs.
    const httpStatus =
      result.reason === "no_credits"
        ? 402
        : result.reason === "job_not_found"
          ? 404
          : 500;
    return NextResponse.json(
      { error: result.reason, message: result.message },
      { status: httpStatus }
    );
  }

  // Return the balance AFTER the spend so the caller can update its counter
  // without a second round trip.
  const balance = await readCreditBalance(supabase, user.id);
  return NextResponse.json(
    { purchaseId: result.purchaseId, balance },
    { headers: { "Cache-Control": "no-store" } }
  );
}

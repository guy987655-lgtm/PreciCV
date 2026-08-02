import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readCreditBalance } from "@/lib/credits";

/**
 * The signed-in user's unlock credits — how many bundle unlocks are left, at
 * which tier, and which orders they came from.
 *
 * `no-store`: a credit spent in another tab must not be served from a cache,
 * or the UI offers a credit that is already gone. Same reasoning as
 * /api/account/free-quota.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const balance = await readCreditBalance(supabase, user.id);
  return NextResponse.json(balance, {
    headers: { "Cache-Control": "no-store" },
  });
}

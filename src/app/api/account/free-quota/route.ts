import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readFreeQuota } from "@/lib/free-quota";

/**
 * Today's free-generation allowance for the signed-in user, so the UI can say
 * "3 of 5 free CVs left today" BEFORE the user spends one rather than only
 * after they hit the wall.
 *
 * Its own route rather than a field on /api/account/preferences: preferences
 * are cacheable and read once on hydrate, while this is a counter that changes
 * whenever the user generates or pays.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const quota = await readFreeQuota(supabase, user.id);
  const res = NextResponse.json(quota);
  // A stale counter is worse than no counter: it would tell a capped user they
  // have generations left, or hide a slot a purchase just credited back.
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

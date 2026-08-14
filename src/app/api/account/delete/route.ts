import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { purgeVisitorData } from "@/lib/visitor-server";

/**
 * Right to be Forgotten (PRD §7): hard cascade delete of the auth user.
 * All app tables reference auth.users with ON DELETE CASCADE, so deleting
 * the user removes profile, master data, jobs, generations and purchases.
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  /**
   * BEFORE the cascade, not after. The visitor tables reference auth.users only
   * loosely — visits.user_id is ON DELETE SET NULL — so the cascade would leave
   * the browser rows behind, and a visitor_id permanently linked to a named
   * person is personal data. Once the auth user is gone there is no way left to
   * find those rows, so this has to run first. It also writes the tombstone the
   * warehouse needs: an incremental load reads rows newer than a watermark and
   * can never notice a row that simply stopped existing.
   */
  await purgeVisitorData(user.id);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}

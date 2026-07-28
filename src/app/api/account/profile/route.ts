import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type ContactShape = { fullName?: unknown };
type MasterShape = { contact?: ContactShape };

/**
 * Who the user is, for the My Account header.
 *
 * There is no `name` column on `profiles` — the only full name the product
 * ever learns is the one parsed out of the uploaded CV into
 * `profiles.master_data.contact.fullName`. OAuth metadata is the fallback for
 * an account that has not uploaded a CV yet. Read defensively rather than
 * through MasterProfileSchema: a half-built master_data must still yield an
 * email, and a strict parse here would 500 the whole page over a missing
 * field elsewhere in the profile.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("profiles")
    .select("master_data")
    .eq("user_id", user.id)
    .maybeSingle();

  const master = (data?.master_data ?? null) as MasterShape | null;
  const fromCv =
    typeof master?.contact?.fullName === "string" ? master.contact.fullName : "";
  const meta = user.user_metadata ?? {};
  const fromOauth =
    typeof meta.full_name === "string"
      ? meta.full_name
      : typeof meta.name === "string"
        ? meta.name
        : "";

  return NextResponse.json({
    email: user.email ?? "",
    fullName: (fromCv || fromOauth).trim(),
  });
}

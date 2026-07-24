import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      // First login → onboarding; returning user → dashboard.
      if (data.user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarded")
          .eq("user_id", data.user.id)
          .maybeSingle();
        // Funnel signups carry next=/continue (which imports the stashed
        // profile and sets onboarded); only cold signups with no funnel in
        // progress fall back to the /onboarding wizard.
        const dest =
          profile?.onboarded || next === "/continue" ? next : "/onboarding";
        return NextResponse.redirect(`${origin}${dest}`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}

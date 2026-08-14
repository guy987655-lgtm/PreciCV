import { NextResponse, after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { linkVisitorUser, recordFunnelEvent } from "@/lib/visitor-server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      // First login → onboarding; returning user → wherever `next` points.
      if (data.user) {
        // The only moment both ids exist together. The browser arrives here on
        // a top-level GET from the OAuth provider, and the visitor cookie is
        // SameSite=Lax, so it rides along — which is the whole reason the
        // anonymous history can be attached to the new account at all.
        //
        // Neither id is overwritten: link_visitor_user records the pairing, and
        // claims the one-and-only signup-visitor slot when the account is
        // brand new. Every later login re-links without disturbing it.
        const user = data.user;
        after(async () => {
          await linkVisitorUser(request, user.id, user.created_at);
          await recordFunnelEvent(request, "signup_linked", {}, user.id);
        });

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

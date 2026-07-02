import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Server-side only — bypasses RLS.
 * Used by the Stripe webhook (no user session) and account deletion.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

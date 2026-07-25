"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type SessionUser = { id: string; email: string | null };

/**
 * The REAL Supabase session for client UI.
 *
 * Not to be confused with `useSimUser`, which is a dev-only state simulator
 * that always reports "guest" in production. Anything user-visible that
 * depends on being signed in — the navbar, the funnel's register gate —
 * must read this instead, or a signed-in user is treated as a stranger.
 */
export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const pick = (u: { id: string; email?: string | null } | null | undefined) =>
      u ? { id: u.id, email: u.email ?? null } : null;

    let supabase;
    try {
      supabase = createClient();
    } catch {
      // Supabase env missing (e.g. a deployment without vars): stay a guest
      // rather than throwing an unhandled rejection into the page.
      setLoading(false);
      return;
    }

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!alive) return;
        setUser(pick(data.user));
        setLoading(false);
      })
      .catch(() => {
        if (alive) setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setUser(pick(session?.user));
      setLoading(false);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { user, loading, signedIn: Boolean(user) };
}

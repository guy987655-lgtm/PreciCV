"use client";

import { useEffect } from "react";
import { identifyUser, initAnalytics } from "@/lib/analytics";
import { useSession } from "@/lib/use-session";

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useSession();

  useEffect(() => {
    initAnalytics();
  }, []);

  /**
   * Attach the account to the analytics session once it is known. Without
   * this, `identifyUser` existed but nothing ever called it, so every event —
   * including purchases — would land on an anonymous device id and the funnel
   * could never be followed across sign-in. Both calls no-op until
   * NEXT_PUBLIC_POSTHOG_KEY is set, so this is inert today and correct the
   * moment the key lands.
   */
  useEffect(() => {
    if (user) identifyUser(user.id, user.email ?? undefined);
  }, [user]);

  return <>{children}</>;
}

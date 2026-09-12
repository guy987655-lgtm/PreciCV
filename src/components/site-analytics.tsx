"use client";

import { Analytics } from "@vercel/analytics/next";
import { isDemoPath } from "@/lib/demo";

/** Vercel Web Analytics, minus the /demo pages (screenshot runs and portfolio embeds aren't traffic). */
export function SiteAnalytics() {
  return (
    <Analytics
      beforeSend={(event) => (isDemoPath(new URL(event.url).pathname) ? null : event)}
    />
  );
}

"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Tells the server this browser is here, on mount and on every route change.
 *
 * The session itself is resolved server-side (touch_visit, migration 0014):
 * 30 minutes of inactivity, a cut at UTC midnight, a 12-hour cap. Nothing about
 * the visit is decided in the browser, so there is no clock here to drift or be
 * tampered with — this only says "still here".
 *
 * Distinct from the PostHog provider mounted beside it: that captures what
 * people click, this records that a session existed. UI events are PostHog's
 * job and stay there.
 */

/** Module-level, not state: it must survive the remounts a route change causes. */
let lastPingAt = 0;
const MIN_INTERVAL_MS = 20_000;

export function VisitBeacon() {
  const pathname = usePathname();

  useEffect(() => {
    const now = Date.now();
    if (now - lastPingAt < MIN_INTERVAL_MS) return;
    lastPingAt = now;

    // keepalive so a ping fired as the user navigates away still lands.
    // Failures are ignored on purpose — a missed ping is a missing tick in a
    // chart, and there is nothing useful to tell the user about it.
    void fetch("/api/session/ping", { method: "POST", keepalive: true }).catch(
      () => {}
    );
  }, [pathname]);

  return null;
}

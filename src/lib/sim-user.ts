"use client";

import { useEffect, useState } from "react";
import { FUNNEL_KEY, saveFunnel } from "./funnel";
import { mockFunnelState } from "./mock-data";

/**
 * DEV/TEST ONLY — User Status Selector. Lets the team preview the product
 * as each of the 5 valid user states before auth/payments are wired up.
 * Switching state: (1) clears session/auth/storage/cookies, (2) injects
 * the mock data + auth state for the chosen status, (3) hard-redirects to
 * the homepage. Rendered only in development (or NEXT_PUBLIC_DEV_TOOLS=true).
 */

const SIM_KEY = "precicv_sim_user";
const SIM_EVENT = "precicv-sim-change";

/**
 * The 5 valid user states. "Paid without Profile" was removed from the
 * architecture — payment is strictly the final step after a profile exists.
 */
export const SIM_STATUSES = [
  {
    id: "guest",
    label: "1 · Unregistered (New Guest)",
    icon: "👤",
    registered: false,
    hasProfile: false,
    paid: false,
  },
  {
    id: "guest_with_profile",
    label: "2 · Unregistered + Profile",
    icon: "🍪",
    registered: false,
    hasProfile: true,
    paid: false,
  },
  {
    id: "registered_no_profile",
    label: "3 · Registered — no Profile",
    icon: "🪪",
    registered: true,
    hasProfile: false,
    paid: false,
  },
  {
    id: "registered_with_profile",
    label: "4 · Registered + Profile (Free)",
    icon: "🗂️",
    registered: true,
    hasProfile: true,
    paid: false,
  },
  {
    id: "paid_with_profile",
    label: "5 · Paid + Profile",
    icon: "💳",
    registered: true,
    hasProfile: true,
    paid: true,
  },
] as const;

export type SimStatus = (typeof SIM_STATUSES)[number]["id"];

/**
 * OFF unless explicitly asked for. Set NEXT_PUBLIC_DEV_TOOLS=true in
 * .env.local to bring the selector back.
 *
 * This used to also switch itself on for the whole of `NODE_ENV=development`,
 * which made it look like a sign-in control on every local run — the chip says
 * "Registered + Profile" while the server still sees an anonymous visitor,
 * because this simulator only writes client-side mock state and never creates
 * a Supabase session. It cost a real debugging session. Left wired up rather
 * than deleted so re-enabling is an env var, not a code change; keeping it
 * live also means it stays typechecked and linted instead of rotting in a
 * commented-out block.
 *
 * If you do turn it on: it is a PREVIEW of the five user states, not an auth
 * bypass. Anything server-rendered or behind an API route will ignore it.
 * Read the real session with useSession() (src/lib/use-session.ts).
 */
export function simEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_TOOLS === "true";
}

function getSimStatus(): SimStatus {
  if (typeof window === "undefined" || !simEnabled()) return "guest";
  const v = localStorage.getItem(SIM_KEY);
  return SIM_STATUSES.some((s) => s.id === v) ? (v as SimStatus) : "guest";
}

export function simMeta(status: SimStatus) {
  return SIM_STATUSES.find((s) => s.id === status)!;
}

/**
 * Switches the simulated user state:
 * 1. clear session, auth tokens, cookies and local/session storage;
 * 2. inject the mock data + auth state for the selected status;
 * 3. hard refresh to the homepage so routing/UI for the state is exercised.
 */
export function applySimStatus(status: SimStatus) {
  // -- 1. Full clear -------------------------------------------------
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    /* private mode */
  }
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (!name) continue;
    document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
  }

  // -- 2. Inject mock data + auth state ------------------------------
  localStorage.setItem(SIM_KEY, status);
  const meta = simMeta(status);
  if (meta.hasProfile) {
    // The launch flow requires a job upfront — every profile mock has one.
    saveFunnel(mockFunnelState({ withJob: true }));
  } else {
    localStorage.removeItem(FUNNEL_KEY);
  }

  // -- 3. Hard refresh to the homepage --------------------------------
  window.location.href = "/";
}

/** Reactive hook — re-renders when the simulated persona changes. */
export function useSimUser(): SimStatus {
  const [status, setStatus] = useState<SimStatus>("guest");
  useEffect(() => {
    const sync = () => setStatus(getSimStatus());
    sync();
    window.addEventListener(SIM_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SIM_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return status;
}

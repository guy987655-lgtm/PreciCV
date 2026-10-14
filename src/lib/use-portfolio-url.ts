"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { isDemoPath } from "./demo";
import {
  PREFS_KEY,
  fetchAccountPrefs,
  loadPrefs,
  rememberPortfolioUrl,
  saveAccountPrefs,
} from "./prefs";

/**
 * The user's portfolio link — printed on every CV as a QR code — read
 * reactively, so saving it in the toolbar redraws every CV on the page.
 *
 * Two stores, like the export preferences: localStorage is the guest half and
 * the instant read; profiles.portfolio_url follows a signed-in user across
 * devices. Unlike the export preferences the ACCOUNT wins once it has an
 * answer: this is a setting the user typed on purpose, not a side effect of
 * their last download, so a stale device must not override it. The account
 * stores a removal as "" (never set is null) precisely so that "removed on
 * another device" and "set as a guest, account never saw it" stay apart.
 */

const CHANGE_EVENT = "precicv:portfolio";

function notify() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === PREFS_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const getSnapshot = () => loadPrefs().portfolioUrl ?? "";
const getServerSnapshot = () => "";

/** Once per page load, however many components ask. */
let synced: Promise<void> | null = null;

async function syncWithAccount() {
  const prefs = await fetchAccountPrefs();
  if (!prefs) return;
  const local = loadPrefs().portfolioUrl;
  if (prefs.portfolioUrl !== null) {
    if (prefs.portfolioUrl !== local) {
      rememberPortfolioUrl(prefs.portfolioUrl || null);
      notify();
    }
  } else if (local) {
    // Set as a guest, then signed in: the account has never seen it.
    void saveAccountPrefs({ portfolioUrl: local });
  }
}

/**
 * The portfolio link, or "" when there is none. `signedIn` enables the account
 * sync; guests read localStorage only, which spares them a request that can
 * only answer 401. Always "" on /demo: the fictional sample CV must never
 * carry a real visitor's link, nor read their account (lib/demo.ts).
 */
export function usePortfolioUrl(signedIn: boolean): string {
  const demo = isDemoPath(usePathname());
  const url = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    if (signedIn && !demo) synced ??= syncWithAccount();
  }, [signedIn, demo]);
  return demo ? "" : url;
}

/** Saves (a normalized URL) or removes ("") the link — on the account too when signed in. */
export function savePortfolioUrl(url: string, signedIn: boolean) {
  rememberPortfolioUrl(url || null);
  notify();
  // Best-effort, like every preference write.
  if (signedIn) void saveAccountPrefs({ portfolioUrl: url });
}

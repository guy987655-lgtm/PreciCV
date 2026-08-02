"use client";

import { useCallback, useEffect, useState } from "react";
import { readJson } from "./fetch-json";
import { CreditBalance, EMPTY_BALANCE } from "./credit-types";

/**
 * The signed-in user's unlock-credit balance.
 *
 * Read on mount and refreshable after any spend. Deliberately quiet on
 * failure: an unreadable balance renders as zero credits, which routes the
 * user to checkout — the honest fallback when we cannot prove they hold one.
 * The authoritative check happens in the database anyway (spend_credit).
 */
export function useCredits(enabled = true) {
  const [balance, setBalance] = useState<CreditBalance>(EMPTY_BALANCE);
  const [fetched, setFetched] = useState(false);
  /**
   * Derived rather than stored, so the disabled case needs no setState in the
   * effect: there is nothing to wait for when we are never going to fetch.
   * Mirrors `nameLoading` in my-account/page.tsx.
   */
  const loaded = !enabled || fetched;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/credits", { cache: "no-store" });
      if (!res.ok) {
        setBalance(EMPTY_BALANCE);
        return;
      }
      const data = await readJson(res);
      setBalance((data as CreditBalance) ?? EMPTY_BALANCE);
    } catch {
      setBalance(EMPTY_BALANCE);
    } finally {
      setFetched(true);
    }
  }, []);

  // Fetched inline rather than by calling refresh(), so the setState lands in
  // a promise callback instead of the effect body — same shape as the quota
  // fetch in my-account/page.tsx and the job workspace.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    fetch("/api/credits", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CreditBalance | null) => {
        if (!alive) return;
        setBalance(data ?? EMPTY_BALANCE);
        setFetched(true);
      })
      .catch(() => {
        // Unreadable balance reads as zero credits, which routes the user to
        // checkout — the honest fallback when we can't prove they hold one.
        if (!alive) return;
        setBalance(EMPTY_BALANCE);
        setFetched(true);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { balance, loaded, refresh, setBalance };
}

export type SpendCreditResult =
  | { ok: true; balance: CreditBalance }
  | { ok: false; outOfCredits: boolean; message: string };

/**
 * Spend one credit on a job. On success the job holds an ordinary paid
 * purchase, so the caller should refresh whatever it renders from that —
 * usually a `router.refresh()` or a re-run of generation.
 */
export async function spendCreditOnJob(
  jobId: string
): Promise<SpendCreditResult> {
  try {
    const res = await fetch("/api/credits/spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId }),
    });
    const data = await readJson(res);
    if (res.ok) {
      return {
        ok: true,
        balance: (data?.balance as CreditBalance) ?? EMPTY_BALANCE,
      };
    }
    return {
      ok: false,
      outOfCredits: res.status === 402,
      message:
        data?.message ??
        data?.error ??
        "We could not apply your credit. Please try again.",
    };
  } catch {
    return {
      ok: false,
      outOfCredits: false,
      message: "We could not reach the server. Please try again.",
    };
  }
}

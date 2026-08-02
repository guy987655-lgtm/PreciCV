"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { loadFunnel } from "@/lib/funnel";
import { trackButtonClick, resetAnalytics } from "@/lib/analytics";
import { useSession } from "@/lib/use-session";
import { useCredits } from "@/lib/use-credits";
import { startPackCheckout } from "@/lib/checkout";
import { PackQuantity } from "@/lib/packs";
import type { FreeQuota } from "@/lib/free-quota";
import { Badge, Button, Card } from "@/components/ui";
import { BundlePaywall } from "@/components/bundle-paywall";
import { ConfirmCountdownModal } from "@/components/confirm-countdown-modal";
import { AccountIdentity } from "@/components/account-identity";
import { Navbar } from "@/components/navbar";

/**
 * My Account — the user's own details plus the account controls. Was
 * "Settings", which showed nothing but the delete button and did not even
 * render the navbar.
 */
export default function MyAccountPage() {
  const router = useRouter();
  const { user, loading: sessionLoading } = useSession();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The email is already in the session; only the name needs a round trip
  // (it lives in profiles.master_data, parsed from the uploaded CV).
  const [fullName, setFullName] = useState("");
  // Derived rather than stored, so nothing has to setState synchronously in
  // the effect for the signed-out case: no user, nothing to wait for.
  const [nameLoaded, setNameLoaded] = useState(false);
  const nameLoading = Boolean(user) && !nameLoaded;
  // Today's free-generation allowance. Null until it loads, or if it fails —
  // the card simply doesn't render, since a wrong count is worse than none.
  const [quota, setQuota] = useState<FreeQuota | null>(null);
  // Unlock credits. `loaded` gates the section so it doesn't flash "0 credits"
  // for a user who has plenty.
  const { balance: credits, loaded: creditsLoaded } = useCredits(
    Boolean(user) && !sessionLoading
  );
  const [packBusy, setPackBusy] = useState(false);

  async function buyPack(quantity: PackQuantity) {
    setPackBusy(true);
    setError("");
    trackButtonClick({
      button_name: "buy_credit_pack",
      action: "checkout",
      button_text: `${quantity}× Full Prep`,
      click_source: "my_account_page",
    });
    try {
      await startPackCheckout(quantity, "/my-account");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPackBusy(false);
    }
  }

  useEffect(() => {
    if (sessionLoading || !user) return;
    let alive = true;
    fetch("/api/account/free-quota")
      .then((r) => (r.ok ? r.json() : null))
      .then((q) => alive && q && setQuota(q))
      .catch(() => {
        /* informational only */
      });
    return () => {
      alive = false;
    };
  }, [user, sessionLoading]);

  useEffect(() => {
    if (sessionLoading || !user) return;
    let alive = true;
    fetch("/api/account/profile")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { fullName?: string }) => {
        if (!alive) return;
        // Fall back to the CV parsed in this browser — a funnel that never
        // reached the account still knows the user's name.
        setFullName(d.fullName || loadFunnel()?.profile?.contact.fullName || "");
      })
      .catch(() => {
        if (alive) setFullName(loadFunnel()?.profile?.contact.fullName || "");
      })
      .finally(() => alive && setNameLoaded(true));
    return () => {
      alive = false;
    };
  }, [user, sessionLoading]);

  async function deleteAccount() {
    setBusy(true);
    setError("");
    trackButtonClick({
      button_name: "delete_account",
      action: "delete",
      button_text: "Delete My Account & Data",
      click_source: "my_account_page",
    });
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error ?? "Deletion failed");
      resetAnalytics();
      router.push("/?deleted=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <Navbar />
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-4">
        <h1 className="font-display text-[30px] font-extrabold tracking-tight text-ink">
          My Account
        </h1>
        <p className="mt-1 text-[14.5px] text-ink-soft">
          Your details and account controls.
        </p>

        <AccountIdentity
          fullName={fullName}
          email={user?.email ?? ""}
          loading={sessionLoading || nameLoading}
        />

        {/* Today's free allowance. Shown here as well as at the point of use,
            so a user who wonders why generation stopped has somewhere to look
            instead of guessing at a limit nothing ever mentioned. */}
        {quota && (
          <Card className="mt-6 p-6">
            <h2 className="font-semibold text-ink">Free CVs today</h2>
            <p className="mt-2 text-sm text-ink-soft">
              You have used <strong>{quota.used}</strong> of{" "}
              <strong>{quota.limit}</strong> free tailored CVs today. Buying a CV
              gives the free one back, so paid CVs never count toward this.
            </p>
            <div
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-chip"
              role="img"
              aria-label={`${quota.remaining} of ${quota.limit} free CVs left today`}
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, (quota.used / Math.max(1, quota.limit)) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 text-[12.5px] text-ink-faint">
              {quota.remaining > 0
                ? `${quota.remaining} left · resets ${new Date(quota.resetAt).toLocaleString()}`
                : `None left · resets ${new Date(quota.resetAt).toLocaleString()}`}
            </p>
          </Card>
        )}

        {/* Unlock credits — the balance, the bundles it came from, and the
            place to buy more. Bundles are the only surface that sells more
            than one unlock at a time, so this section is also the entry point
            for volume pricing. */}
        {creditsLoaded && user && (
          <Card className="mt-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-ink">Unlock credits</h2>
              {credits.total > 0 && (
                <Badge tone="green">
                  {credits.total} left
                </Badge>
              )}
            </div>

            {credits.total > 0 ? (
              <p className="mt-2 text-sm text-ink-soft">
                You have <strong>{credits.total}</strong> unlock
                {credits.total === 1 ? "" : "s"} left. Spend one on any job —
                they don&apos;t expire.
              </p>
            ) : (
              <p className="mt-2 text-sm text-ink-soft">
                Applying to several roles? Buying unlocks in a bundle costs less
                per job, and you can spend them whenever you like.
              </p>
            )}

            <div className="mt-5 border-t border-border pt-5">
              <h3 className="mb-3 text-sm font-semibold text-ink">
                {credits.total > 0 ? "Buy more" : "Buy unlocks"}
              </h3>
              <BundlePaywall
                busy={packBusy}
                onSelect={buyPack}
                hint="Credits work on any job, whenever you're ready."
              />
            </div>
          </Card>
        )}

        <Card className="mt-8 border-red-200 p-6">
          <h2 className="font-semibold text-red-700">Danger zone</h2>
          <p className="mt-2 text-sm text-slate-600">
            <strong>Right to be forgotten.</strong> This permanently deletes
            your account, your Master Data Lake, all jobs, generated CVs,
            reports and purchase records. This cannot be undone.
          </p>
          <Button
            variant="danger"
            className="mt-4"
            onClick={() => setConfirmOpen(true)}
          >
            Delete My Account &amp; Data
          </Button>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </Card>
      </div>

      {/* The countdown is shared with My Card's clear-data flow. This action
          is the more destructive of the two, so it gets the same guard. */}
      <ConfirmCountdownModal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete everything?"
        confirmLabel="Yes, delete everything"
        cancelLabel="Keep my account"
        busy={busy}
        onConfirm={deleteAccount}
      >
        <p>
          All of your data — profile, CVs, reports, and history — will be
          permanently and irreversibly erased.
        </p>
      </ConfirmCountdownModal>
    </main>
  );
}

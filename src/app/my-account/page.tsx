"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { loadFunnel } from "@/lib/funnel";
import { trackButtonClick, resetAnalytics } from "@/lib/analytics";
import { useSession } from "@/lib/use-session";
import { Button, Card, Modal, Spinner } from "@/components/ui";
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

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Delete everything?"
      >
        <p className="text-sm text-slate-600">
          All of your data — profile, CVs, reports, and history — will be
          permanently and irreversibly erased.
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>
            Keep my account
          </Button>
          <Button variant="danger" disabled={busy} onClick={deleteAccount}>
            {busy ? <Spinner /> : "Yes, delete everything"}
          </Button>
        </div>
      </Modal>
    </main>
  );
}

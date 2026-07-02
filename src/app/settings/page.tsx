"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackButtonClick, resetAnalytics } from "@/lib/analytics";
import { Button, Card, Modal, Spinner } from "@/components/ui";

export default function SettingsPage() {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function deleteAccount() {
    setBusy(true);
    setError("");
    trackButtonClick({
      button_name: "delete_account",
      action: "delete",
      button_text: "Delete My Account & Data",
      click_source: "settings_page",
    });
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Deletion failed");
      resetAnalytics();
      router.push("/?deleted=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <Link href="/dashboard" className="text-sm text-indigo-600 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Settings</h1>

      <Card className="mt-8 border-red-200 p-6">
        <h2 className="font-semibold text-red-700">Danger zone</h2>
        <p className="mt-2 text-sm text-slate-600">
          <strong>Right to be forgotten.</strong> This permanently deletes your
          account, your Master Data Lake, all jobs, generated CVs, reports and
          purchase records. This cannot be undone.
        </p>
        <Button variant="danger" className="mt-4" onClick={() => setConfirmOpen(true)}>
          Delete My Account &amp; Data
        </Button>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </Card>

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

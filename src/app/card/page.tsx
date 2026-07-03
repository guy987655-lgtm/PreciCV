"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FunnelState,
  loadFunnel,
  saveFunnel,
  stashForSignup,
} from "@/lib/funnel";
import { trackButtonClick } from "@/lib/analytics";
import { Button, Card } from "@/components/ui";
import { UserCard } from "@/components/user-card";

/**
 * The standalone User Card page: the candidate's dossier (latest CV +
 * every answer). Guests see the card built in the anonymous funnel
 * (browser-only); saving it just requires a free account.
 */
export default function CardPage() {
  const router = useRouter();
  const [state, setState] = useState<FunnelState | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadFunnel());
    setHydrated(true);
  }, []);

  function save() {
    if (!state) return;
    trackButtonClick({
      button_name: "save_user_card",
      action: "signup_gate",
      button_text: "Save my card — free",
      click_source: "card_page",
    });
    stashForSignup(state);
    router.push("/login?next=/continue");
  }

  function tailorToJob() {
    if (!state) return;
    saveFunnel({ ...state, step: "job" });
    router.push("/");
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <nav className="mb-8 flex items-center justify-between">
        <Link href="/" className="text-xl font-bold text-indigo-700">
          PreciCV
        </Link>
        <Link href="/login" className="text-sm text-indigo-600 hover:underline">
          Sign in
        </Link>
      </nav>

      {hydrated && !state?.profile && (
        <Card className="p-10 text-center">
          <span className="text-3xl">🗂️</span>
          <h1 className="mt-3 text-xl font-bold text-slate-900">
            No User Card yet
          </h1>
          <p className="mx-auto mt-2 max-w-sm text-sm text-slate-600">
            Your card is your career dossier: your latest CV plus everything
            you tell us about it. Build it in about 3 minutes — no account
            needed.
          </p>
          <Link href="/">
            <Button size="lg" className="mt-5">
              Build my card
            </Button>
          </Link>
        </Card>
      )}

      {hydrated && state?.profile && (
        <>
          <h1 className="text-2xl font-bold text-slate-900">Your User Card</h1>
          <p className="mt-1 text-sm text-slate-600">
            Stored in this browser only. Save it to a free account so it
            follows you anywhere — and unlocks free tips.
          </p>

          <div className="mt-5">
            <UserCard state={state} />
          </div>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={save}>
              Save my card — free
            </Button>
            <Button onClick={tailorToJob}>Tailor my CV to a job →</Button>
          </div>
        </>
      )}
    </main>
  );
}

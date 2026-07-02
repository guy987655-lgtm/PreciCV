"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { trackButtonClick } from "@/lib/analytics";
import { Button, Card } from "@/components/ui";

const PROVIDERS = [
  { id: "google", label: "Continue with Google" },
  { id: "linkedin_oidc", label: "Continue with LinkedIn" },
  { id: "github", label: "Continue with GitHub" },
] as const;

function LoginForm() {
  const searchParams = useSearchParams();
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState(
    searchParams.get("error") ? "Sign-in failed. Please try again." : ""
  );

  async function signIn(provider: (typeof PROVIDERS)[number]) {
    trackButtonClick({
      button_name: `oauth_${provider.id}`,
      action: "sign_in",
      button_text: provider.label,
      click_source: "login_page",
    });
    const supabase = createClient();
    const next = searchParams.get("next") ?? "/dashboard";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: provider.id,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <Card className="w-full max-w-md p-8">
      <h1 className="text-center text-2xl font-bold text-indigo-700">
        PreciCV
      </h1>
      <p className="mt-2 text-center text-sm text-slate-600">
        Sign in to your career agent
      </p>

      {/* Explicit consent (PRD §7) — providers stay disabled until checked */}
      <label className="mt-6 flex items-start gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={consented}
          onChange={(e) => setConsented(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-indigo-600"
        />
        <span>
          I agree to the{" "}
          <a href="/terms" className="text-indigo-600 underline">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="/privacy" className="text-indigo-600 underline">
            Privacy Policy
          </a>
          , and consent to my CV data being processed to generate tailored
          resumes.
        </span>
      </label>

      <div className="mt-5 space-y-3">
        {PROVIDERS.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            className="w-full"
            disabled={!consented}
            onClick={() => signIn(p)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {error && <p className="mt-4 text-center text-sm text-red-600">{error}</p>}
    </Card>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}

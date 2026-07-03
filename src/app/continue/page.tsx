"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/fetch-json";
import { Card, Spinner } from "@/components/ui";
import { PENDING_KEY } from "../try-now";

/**
 * Landing spot after OAuth for users who started anonymously on the
 * landing page: imports the stashed profile + answers + JD, then jumps
 * straight to the created job (or the dashboard).
 */
export default function ContinuePage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) {
      router.replace("/dashboard");
      return;
    }

    (async () => {
      try {
        const stash = JSON.parse(raw);
        const res = await fetch("/api/try/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            profile: stash.profile,
            rawText: stash.rawText ?? "",
            answers:
              stash.questionnaire?.questions?.map(
                (q: { id: string; question: string }) => ({
                  question: q.question,
                  answer: stash.answers?.[q.id] ?? "",
                })
              ) ?? [],
            jdText: stash.jdText ?? "",
          }),
        });
        const data = await readJson(res);
        if (!res.ok) throw new Error(data.error ?? "Import failed");
        localStorage.removeItem(PENDING_KEY);
        router.replace(data.jobId ? `/jobs/${data.jobId}` : "/dashboard");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      }
    })();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="p-10 text-center">
        {error ? (
          <>
            <p className="text-sm text-red-600">{error}</p>
            <button
              className="mt-4 text-sm text-indigo-600 underline cursor-pointer"
              onClick={() => router.replace("/dashboard")}
            >
              Go to dashboard
            </button>
          </>
        ) : (
          <Spinner label="Setting up your profile and job…" />
        )}
      </Card>
    </main>
  );
}

"use client";

import { Card } from "@/components/ui";
import { Skeleton } from "@/components/skeleton";

/**
 * The "who am I signed in as" header on My Account. Presentational only —
 * the page owns the fetch, so a different layout can be swapped in against
 * this same contract.
 */
export function AccountIdentity({
  fullName,
  email,
  loading,
}: {
  fullName: string;
  email: string;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Card className="mt-6 flex items-center gap-4 p-5">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-2 h-3 w-56" />
        </div>
      </Card>
    );
  }

  // Same derivation as the navbar avatar, so the two agree on screen.
  const initial = (fullName.trim()[0] ?? email.trim()[0] ?? "?").toUpperCase();

  return (
    <Card className="mt-6 flex items-center gap-4 p-5">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-xl font-bold text-on-accent">
        {initial}
      </span>
      <div className="min-w-0">
        {fullName ? (
          <p className="truncate text-[17px] font-bold text-ink">{fullName}</p>
        ) : (
          // No CV parsed and no OAuth name: say so rather than render a
          // blank line where the name should be.
          <p className="text-[15px] font-semibold text-ink-faint">
            Name not set yet
          </p>
        )}
        <p className="mt-0.5 truncate text-sm text-ink-soft" title={email}>
          {email || "No email on file"}
        </p>
      </div>
    </Card>
  );
}

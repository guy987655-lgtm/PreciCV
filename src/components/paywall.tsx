"use client";

import { TIERS, TierId } from "@/lib/types";
import { Badge, Button, Card, Spinner } from "@/components/ui";

/**
 * The Paywall — appears right BEFORE final document generation, after the
 * profile (and optionally a job description) already exist. Tiers that
 * require a job description stay locked until one is added.
 */
export function Paywall({
  hasJob,
  busy = false,
  onSelect,
  onAddJob,
}: {
  /** a job description exists for this purchase context */
  hasJob: boolean;
  busy?: boolean;
  onSelect: (tier: TierId) => void;
  /** optional: lets locked tiers offer a shortcut to add a job */
  onAddJob?: () => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {(Object.entries(TIERS) as [TierId, (typeof TIERS)[TierId]][]).map(
        ([tierId, tier]) => {
          const locked = tier.requiresJob && !hasJob;
          return (
            <Card
              key={tierId}
              className={`flex flex-col p-5 ${
                tierId === "match" ? "border-2 border-accent" : ""
              } ${locked ? "opacity-80" : ""}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-ink">{tier.name}</h3>
                {tierId === "match" && <Badge tone="indigo">Popular</Badge>}
              </div>
              <p className="mt-1 font-display text-3xl font-extrabold text-ink">
                ${tier.priceUsd}
                <span className="font-sans text-sm font-normal text-ink-faint"> one-time</span>
              </p>
              <ul className="mt-3 flex-1 space-y-1.5 text-sm text-ink-soft">
                {tier.includes.map((line) => (
                  <li key={line}>✓ {line}</li>
                ))}
              </ul>
              {locked ? (
                <>
                  <Button className="mt-4 w-full" variant="outline" disabled>
                    🔒 Needs a job description
                  </Button>
                  {onAddJob && (
                    <button
                      className="mt-2 cursor-pointer text-center text-xs text-accent underline"
                      onClick={onAddJob}
                    >
                      Add a job description to unlock
                    </button>
                  )}
                </>
              ) : (
                <Button
                  className="mt-4 w-full"
                  variant={tierId === "match" ? "primary" : "outline"}
                  disabled={busy}
                  onClick={() => onSelect(tierId)}
                >
                  {busy ? <Spinner /> : `Get ${tier.name} — $${tier.priceUsd}`}
                </Button>
              )}
            </Card>
          );
        }
      )}
    </div>
  );
}

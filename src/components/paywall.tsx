"use client";

import { TIERS } from "@/lib/types";
import { freeMode } from "@/lib/free-mode";
import { Button, Card, Spinner } from "@/components/ui";

/**
 * The Paywall — appears right BEFORE final document generation, after the
 * profile (and optionally a job description) already exist.
 *
 * One product, one card: every purchase includes the tailored CV, the
 * comparison report and the interview simulation report. Full Prep requires a
 * job description, so it stays locked until one is added.
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
  onSelect: () => void;
  /** optional: lets the locked card offer a shortcut to add a job */
  onAddJob?: () => void;
}) {
  const tier = TIERS.full;
  const locked = tier.requiresJob && !hasJob;
  // The beta gives this away; the card stays, only its price does not.
  const free = freeMode();

  return (
    <Card
      className={`mx-auto flex max-w-md flex-col border-2 border-accent p-5 ${
        locked ? "opacity-80" : ""
      }`}
    >
      <h3 className="font-bold text-ink">{tier.name}</h3>
      <p className="mt-1 font-display text-3xl font-extrabold text-ink">
        {free ? "Free" : `$${tier.priceUsd}`}
        <span className="font-sans text-sm font-normal text-ink-faint">
          {" "}
          {free ? "while in beta" : "one-time"}
        </span>
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
        <Button className="mt-4 w-full" disabled={busy} onClick={onSelect}>
          {busy ? (
            <Spinner />
          ) : free ? (
            "Unlock free"
          ) : (
            `Get ${tier.name} — $${tier.priceUsd}`
          )}
        </Button>
      )}
    </Card>
  );
}

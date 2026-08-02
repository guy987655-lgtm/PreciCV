"use client";

import { useState } from "react";
import { TIERS } from "@/lib/types";
import {
  PACK_QUANTITIES,
  PackQuantity,
  centsToUsd,
  packHasDiscount,
  packListCents,
  packPriceCents,
  packSavingPct,
} from "@/lib/packs";
import { Badge, Button, Card } from "@/components/ui";

/**
 * Volume paywall — pick how many unlocks to buy. That is the whole decision.
 *
 * There used to be a second axis here, a cheaper tier that bought the CV
 * without the interview report, rendered as a two-card grid. Asking someone to
 * price out a document bundle before they have seen a document is friction at
 * the worst possible moment, so every purchase now includes everything and
 * quantity is all that is left to choose.
 *
 * Unlocks bought here are CREDITS: they are not tied to a job at purchase
 * time, so a user can buy five today and spend the fifth next week. That is
 * the difference from Paywall (src/components/paywall.tsx), which buys one
 * specific job and stays the right component for the single-job workspace.
 */
export function BundlePaywall({
  defaultQuantity = 1,
  busy = false,
  onSelect,
  /** Copy shown under the quantity picker; e.g. "3 jobs still locked." */
  hint,
}: {
  defaultQuantity?: PackQuantity;
  busy?: boolean;
  onSelect: (quantity: PackQuantity) => void;
  hint?: string;
}) {
  const [qty, setQty] = useState<PackQuantity>(defaultQuantity);
  const price = packPriceCents(qty);
  const list = packListCents(qty);
  const discounted = packHasDiscount(qty);

  return (
    <div>
      {/* Quantity picker */}
      <div
        className="flex flex-wrap justify-center gap-2"
        role="radiogroup"
        aria-label="How many job unlocks"
      >
        {PACK_QUANTITIES.map((n) => {
          const active = n === qty;
          const pct = packSavingPct(n);
          return (
            <button
              key={n}
              role="radio"
              aria-checked={active}
              onClick={() => setQty(n)}
              className={`cursor-pointer rounded-full border-[1.5px] px-4 py-2 text-sm font-semibold transition-colors ${
                active
                  ? "border-accent bg-selected-bg text-accent-deep"
                  : "border-border-strong bg-transparent text-ink-soft hover:bg-card"
              }`}
            >
              {n} {n === 1 ? "job" : "jobs"}
              {pct > 0 && (
                <span className="ml-1.5 text-[11px] font-bold text-accent">
                  −{pct}%
                </span>
              )}
            </button>
          );
        })}
      </div>
      {hint && (
        <p className="mt-2 text-center text-xs text-ink-faint">{hint}</p>
      )}

      <Card className="mx-auto mt-4 flex max-w-md flex-col border-2 border-accent p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold text-ink">{TIERS.full.name}</h3>
          {discounted && <Badge tone="indigo">Save {packSavingPct(qty)}%</Badge>}
        </div>

        <p className="mt-1 font-display text-3xl font-extrabold text-ink">
          {discounted && (
            <span className="mr-2 align-middle font-sans text-lg font-semibold text-ink-faint line-through">
              ${centsToUsd(list)}
            </span>
          )}
          ${centsToUsd(price)}
          <span className="font-sans text-sm font-normal text-ink-faint">
            {" "}
            one-time
          </span>
        </p>
        <p className="mt-0.5 text-xs text-ink-faint">
          {qty === 1
            ? "One job unlock"
            : `${qty} job unlocks — $${centsToUsd(
                Math.round(price / qty)
              )} each`}
        </p>

        <ul className="mt-3 flex-1 space-y-1.5 text-sm text-ink-soft">
          {TIERS.full.includes.map((line) => (
            <li key={line}>✓ {line}</li>
          ))}
          {qty > 1 && (
            <li className="text-ink-faint">
              ✓ Use them whenever — credits don&apos;t expire
            </li>
          )}
        </ul>

        <Button
          className="mt-4 w-full"
          loading={busy}
          loadingLabel="Opening checkout…"
          onClick={() => onSelect(qty)}
        >
          {qty === 1
            ? `Get ${TIERS.full.name} — $${centsToUsd(price)}`
            : `Get ${qty} for $${centsToUsd(price)}`}
        </Button>
      </Card>
    </div>
  );
}

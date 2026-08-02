"use client";

import { useState } from "react";
import { TIERS } from "@/lib/types";
import {
  PACK_QUANTITIES,
  PACK_TIERS,
  PackQuantity,
  PackTier,
  centsToUsd,
  packHasDiscount,
  packListCents,
  packPriceCents,
  packSavingPct,
} from "@/lib/packs";
import { Badge, Button, Card } from "@/components/ui";

/** The tier we steer users toward — it carries the interview reports. */
const HIGHLIGHT_TIER: PackTier = "full";

/**
 * Volume paywall — pick how many unlocks to buy, then which tier.
 *
 * Unlocks bought here are CREDITS: they are not tied to a job at purchase
 * time, so a user can buy five today and spend the fifth next week. That is
 * the difference from Paywall (src/components/paywall.tsx), which buys one
 * specific job and stays the right component for the single-job workspace.
 */
export function BundlePaywall({
  defaultQuantity = 1,
  busyTier = null,
  onSelect,
  /** Copy shown under the quantity picker; e.g. "3 jobs still locked." */
  hint,
}: {
  defaultQuantity?: PackQuantity;
  busyTier?: PackTier | null;
  onSelect: (tier: PackTier, quantity: PackQuantity) => void;
  hint?: string;
}) {
  const [qty, setQty] = useState<PackQuantity>(defaultQuantity);

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
          const pct = packSavingPct(HIGHLIGHT_TIER, n);
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

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {PACK_TIERS.map((tierId) => {
          const tier = TIERS[tierId];
          const highlighted = tierId === HIGHLIGHT_TIER;
          const price = packPriceCents(tierId, qty);
          const list = packListCents(tierId, qty);
          const discounted = packHasDiscount(tierId, qty);
          return (
            <Card
              key={tierId}
              className={`flex flex-col p-5 ${
                highlighted ? "border-2 border-accent" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-ink">{tier.name}</h3>
                {highlighted && <Badge tone="indigo">Best value</Badge>}
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
                {tier.includes.map((line) => (
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
                variant={highlighted ? "primary" : "outline"}
                loading={busyTier === tierId}
                loadingLabel="Opening checkout…"
                disabled={busyTier !== null && busyTier !== tierId}
                onClick={() => onSelect(tierId, qty)}
              >
                {qty === 1
                  ? `Get ${tier.name} — $${centsToUsd(price)}`
                  : `Get ${qty} for $${centsToUsd(price)}`}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

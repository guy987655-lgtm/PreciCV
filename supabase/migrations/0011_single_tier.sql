-- 0011 — one product.
--
-- The app used to sell two tiers: `match` bought the tailored CV and the
-- comparison report, `full` added the interview simulation report. That single
-- distinction is what produced the split download buttons, the blurred report
-- sections and three separate upgrade checkouts. Every purchase now includes
-- every document, so `match` no longer exists in the code.
--
-- Existing `match` buyers are grandfathered into `full` rather than left on a
-- tier nothing understands. This costs nothing to honour: the interview
-- simulation was always generated and stored for EVERY tier and merely
-- rendered blurred, so flipping the tier reveals reports that already exist —
-- no LLM calls, no new generation rows. It is the same one-line effect the
-- retired applyOrderUpgrade() had, applied to everyone at once.
--
-- `base` was hidden product-wide and never had a Lemon Squeezy variant, so any
-- row carrying it is test data; it moves too rather than being left orphaned.

update public.purchases set tier = 'full' where tier <> 'full';
update public.orders    set tier = 'full' where tier <> 'full';

-- Deliberately NOT tightening the `tier` check constraints on either table:
-- both already permit 'full', which is the only value written from here on,
-- and dropping a constraint by an auto-generated name is avoidable risk for no
-- behavioural gain.
--
-- Also left in place: orders.upgrade_amount_cents and upgrade_provider_ref.
-- They are dead columns now, but they hold the audit trail of upgrades people
-- actually paid for, and dropping columns is not worth doing for tidiness.

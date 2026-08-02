-- Bundle pricing (credits) + bulk batches.
--
-- 1. `orders` is a BUNDLE purchase: "5 Job Match unlocks for $8". It grants
--    credits, not access. Access is still a row in `purchases`, one per job,
--    exactly as before — spending a credit MINTS that row. That is the whole
--    trick: every existing entitlement check (/api/generate, /api/rewrite,
--    /api/generations/[id], jobs/[id]/page.tsx) asks "is there a paid purchase
--    for this job_id?" and keeps working untouched, and `unique (job_id)` from
--    0001 stays exactly as it is.
--
-- 2. Credits are DERIVED, never stored: credits_total minus the number of
--    purchases pointing at the order. Same discipline as the daily free cap in
--    src/lib/free-quota.ts — one definition, no counter column to drift, no
--    backfill. A refund that deletes purchases returns the credits for free.
--
-- 3. `jobs.batch_id` groups the jobs created in one /batch submission.
--
-- 4. The whole-order upgrade (match -> full, $1/$2 depending on pack size)
--    flips `orders.tier` AND every purchase already minted from that order.
--    Since the interview simulation is generated and stored for every tier and
--    only rendered blurred (workspace.tsx `simLocked`), that single UPDATE
--    unlocks the reports retroactively with no LLM call.

-- ============================================================
-- orders: a bundle of credits
-- ============================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 'match_x5' — see packSku() in src/lib/packs.ts. Kept as text so a pricing
  -- change never needs a migration; the app owns the matrix.
  sku text not null,
  -- Flipped in place by the upgrade webhook. 'base' is deliberately not
  -- offered in bundles (it is hidden from the UI entirely).
  tier text not null check (tier in ('match', 'full')),
  credits_total int not null check (credits_total between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'paid', 'refunded')),
  amount_cents int not null default 0,
  provider_ref text,
  -- The whole-order upgrade is a SECOND payment against the same order, so it
  -- gets its own amount and provider reference rather than being folded into
  -- the ones above. A refund request needs to see both charges separately.
  upgrade_amount_cents int not null default 0,
  upgrade_provider_ref text,
  created_at timestamptz not null default now()
);
create index orders_user_idx on public.orders (user_id, created_at desc);

-- The link that makes a per-job unlock traceable to the bundle that paid for
-- it. Null for the single-job purchases that predate bundles, and for any
-- future direct purchase — those are still perfectly valid rows.
alter table public.purchases
  add column order_id uuid references public.orders (id) on delete set null;

-- Counting an order's spent credits is the hot path for the balance and for
-- every spend, so index the side we probe from.
create index purchases_order_idx
  on public.purchases (order_id)
  where order_id is not null;

-- ============================================================
-- jobs: batch grouping
-- ============================================================
alter table public.jobs add column batch_id uuid;

create index jobs_batch_idx
  on public.jobs (user_id, batch_id)
  where batch_id is not null;

-- ============================================================
-- RLS
-- ============================================================
alter table public.orders enable row level security;

-- READ-ONLY for the user, deliberately narrower than the other tables.
--
-- `orders` is money: a policy of `for all using (auth.uid() = user_id)` would
-- let anyone with their own access token INSERT an order with status 'paid'
-- from the browser and mint themselves unlimited credits. Every write to this
-- table therefore goes through the service role (the Lemon Squeezy webhook and
-- /api/payments/checkout) or through spend_credit() below, which is
-- security definer and does its own checks.
create policy "own orders read" on public.orders
  for select using (auth.uid() = user_id);

-- ============================================================
-- spend_credit(): atomically turn one credit into a job unlock
-- ============================================================
--
-- Must be atomic, or two tabs unlocking two jobs against the last credit both
-- read "1 left" and both insert. The row lock on the chosen order is what
-- serializes them: the loop locks a candidate order FIRST and only then counts
-- its spent credits, so the loser of the race re-counts after the winner has
-- committed and correctly moves on to the next order (or runs out).
--
-- Counting inside the lock rather than in the SELECT's own WHERE clause is
-- deliberate: a subquery in the qual is evaluated against the pre-lock
-- snapshot, which is exactly the read the lock is supposed to protect.
--
-- FIFO across orders (oldest paid order first). Predictable and explainable —
-- credits are spent in the order they were bought. A user holding both match
-- and full credits gets no choice in v1; that is a UI feature, not a data one.
create or replace function public.spend_credit(p_job_id uuid)
returns uuid
language plpgsql
security definer
-- Pinned: a security definer function without this is hijackable via a
-- caller-controlled search_path.
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_used int;
  v_purchase_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- security definer bypasses RLS, so ownership is checked by hand.
  perform 1 from public.jobs
   where id = p_job_id and user_id = v_user_id and deleted_at is null;
  if not found then
    raise exception 'job_not_found' using errcode = 'P0002';
  end if;

  -- Idempotent: an already-unlocked job returns its existing purchase instead
  -- of burning a second credit. A double-submit costs the user nothing.
  select id into v_purchase_id
    from public.purchases
   where job_id = p_job_id and status = 'paid';
  if found then
    return v_purchase_id;
  end if;

  for v_order in
    select * from public.orders
     where user_id = v_user_id and status = 'paid'
     order by created_at asc
     for update
  loop
    select count(*) into v_used
      from public.purchases
     where order_id = v_order.id;

    if v_used < v_order.credits_total then
      insert into public.purchases
        (user_id, job_id, tier, status, amount_cents, order_id)
      values
        (v_user_id, p_job_id, v_order.tier, 'paid', 0, v_order.id)
      returning id into v_purchase_id;
      return v_purchase_id;
    end if;
  end loop;

  raise exception 'no_credits' using errcode = 'P0001';
end;
$$;

revoke all on function public.spend_credit(uuid) from public;
grant execute on function public.spend_credit(uuid) to authenticated;

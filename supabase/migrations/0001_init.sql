-- PreciCV initial schema
-- Run in the Supabase SQL editor (or `supabase db push`).

-- ============================================================
-- profiles: one row per user — the Master Data Lake
-- ============================================================
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text,
  master_data jsonb not null default '{}'::jsonb,
  dealbreakers jsonb not null default '[]'::jsonb,
  raw_cv_text text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- jobs: one row per job application (JD)
-- ============================================================
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  company text,
  jd_text text not null,
  jd_url text,
  dealbreaker_hits jsonb not null default '[]'::jsonb,
  status text not null default 'created', -- created | generated
  created_at timestamptz not null default now()
);
create index jobs_user_idx on public.jobs (user_id, created_at desc);

-- ============================================================
-- generations: tailored CVs + diff reports (revision 0 = original)
-- ============================================================
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  cv jsonb not null,
  diff jsonb not null,
  template text not null default 'classic',
  revision_number int not null default 0,
  created_at timestamptz not null default now(),
  unique (job_id, revision_number)
);
create index generations_job_idx on public.generations (job_id, revision_number desc);

-- ============================================================
-- purchases: one purchase per job (Standard $10 / Premium $15)
-- ============================================================
create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid not null references public.jobs (id) on delete cascade,
  tier text not null check (tier in ('standard', 'premium')),
  status text not null default 'pending', -- pending | paid
  amount_cents int not null default 0,
  stripe_session_id text,
  revisions_used int not null default 0,
  created_at timestamptz not null default now(),
  unique (job_id)
);
create index purchases_user_idx on public.purchases (user_id);

-- ============================================================
-- Row Level Security: every user sees only their own rows
-- ============================================================
alter table public.profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.generations enable row level security;
alter table public.purchases enable row level security;

create policy "own profile" on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own jobs" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own generations" on public.generations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Purchases: users may read their own; writes happen server-side.
-- (The authenticated server routes act as the user, so insert/update
-- are allowed for own rows; the Stripe webhook uses the service role.)
create policy "own purchases" on public.purchases
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at trigger for profiles
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

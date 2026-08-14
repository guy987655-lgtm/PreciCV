-- 0012 — make the OLTP tables readable by an incremental warehouse.
--
-- Four tables mutate in place long after their insert, and not one of them
-- records when:
--
--   jobs         title/company/status are backfilled by /api/generate
--   generations  the cv jsonb is rewritten by every inline edit, and
--                diff/simulation by every report regeneration
--   purchases    status pending -> paid, plus three AI-action counters
--   orders       status pending -> paid by the Lemon Squeezy webhook
--
-- Without updated_at an incremental ETL either rescans every row on every run
-- or silently serves stale ones; a rolling "last 30 days" window is a guess
-- that goes quietly wrong the first time someone edits an old CV.
--
-- public.set_updated_at() already exists (0001) and profiles/profile_answers
-- already use it, so this is four columns and four triggers with no new
-- machinery. Safe to run twice.

alter table public.jobs        add column if not exists updated_at timestamptz not null default now();
alter table public.generations add column if not exists updated_at timestamptz not null default now();
alter table public.purchases   add column if not exists updated_at timestamptz not null default now();
alter table public.orders      add column if not exists updated_at timestamptz not null default now();

do $$
declare t text;
begin
  foreach t in array array['jobs', 'generations', 'purchases', 'orders'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.set_updated_at()',
      t || '_updated_at', t);
  end loop;
end $$;

-- The ETL reads "everything changed since the watermark" from every one of
-- these, so the watermark predicate is the hot path.
create index if not exists jobs_updated_idx        on public.jobs (updated_at);
create index if not exists generations_updated_idx on public.generations (updated_at);
create index if not exists purchases_updated_idx   on public.purchases (updated_at);
create index if not exists orders_updated_idx      on public.orders (updated_at);

-- ============================================================
-- jd_hash — the only join key between an anonymous paste and the job row
-- it later became
-- ============================================================
--
-- A visitor pastes a job description while signed out; nothing is stored.
-- Minutes later they sign up and /api/try/import writes that same text into
-- public.jobs. Analytics has to recognise those as one job, and the only
-- thing the two events share is the text itself.
--
-- Generated + stored rather than written by the app, so it can never drift
-- from jd_text and no route has to remember to set it. Every function in the
-- expression is IMMUTABLE, which is what makes it legal in a generated column.
--
-- The TypeScript side (jdHash() in src/lib/visitor-server.ts) must produce
-- byte-identical output; the S5 check in the analytics verification queries
-- measures the join rate precisely so drift is visible rather than silent.
alter table public.jobs
  add column if not exists jd_hash text
  generated always as (
    md5(regexp_replace(btrim(lower(jd_text)), '[[:space:]]+', ' ', 'g'))
  ) stored;

create index if not exists jobs_jd_hash_idx on public.jobs (jd_hash);

-- ============================================================
-- Which anonymous browser produced this job
-- ============================================================
--
-- Written once, by /api/try/import, right after the bulk insert. NULL for
-- every job created before this shipped, and for any browser that refused the
-- cookie — both are ordinary rows, not errors.
--
-- The foreign keys are deliberately deferred to 0013: public.visitors does not
-- exist yet, and splitting the migration is worse than splitting the constraint.
alter table public.jobs add column if not exists origin_visitor_id uuid;
alter table public.jobs add column if not exists origin_visit_id   uuid;

create index if not exists jobs_origin_visitor_idx
  on public.jobs (origin_visitor_id) where origin_visitor_id is not null;

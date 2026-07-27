-- History management + progressive profiling.
--
-- 1. Jobs get a user-chosen display name and a soft-delete flag, so the
--    History page can offer the same rename/delete actions for account-saved
--    flows that localStorage flows already had. Deletion is soft on purpose:
--    a purchased job carries a payment record, and destroying it would leave
--    a refund request with nothing to point at.
--
-- 2. profile_answers is the cross-job memory. Answers used to survive only as
--    flattened "Question — Answer" strings inside profiles.master_data, which
--    cannot be matched against a new job's questions, so every application
--    re-asked everything. One row per (user, question) keeps them addressable
--    and editable from My Card.

alter table public.jobs
  add column display_name text,
  add column deleted_at timestamptz;

-- History lists non-deleted jobs newest-first; keep that path indexed.
create index jobs_user_active_idx
  on public.jobs (user_id, created_at desc)
  where deleted_at is null;

create table public.profile_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  question text not null,
  answer text not null,
  -- 'mcq' answers are formatted option strings; 'open' are free text.
  kind text not null default 'open' check (kind in ('mcq', 'open')),
  -- MCQ answers only: { selected: text[], other?: text, options: text[] }.
  -- `answer` above is the readable form (what the tailoring prompt consumes);
  -- this keeps the structure, so the same answer can be replayed onto a later
  -- question whose option set is worded differently. Null for open answers.
  payload jsonb,
  source_job_id uuid references public.jobs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One canonical answer per question per user; re-answering updates in place.
  unique (user_id, question)
);
create index profile_answers_user_idx
  on public.profile_answers (user_id, updated_at desc);

alter table public.profile_answers enable row level security;

create policy "own answers" on public.profile_answers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create trigger profile_answers_updated_at
  before update on public.profile_answers
  for each row execute function public.set_updated_at();

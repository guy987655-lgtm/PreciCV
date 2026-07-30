-- Supports the daily free-generation cap (src/lib/free-quota.ts).
--
-- The cap is DERIVED rather than stored: "revision-0 generations created today
-- whose job has no paid purchase". That definition is what credits a slot back
-- when a user pays, with no counter column, no webhook change and no backfill —
-- but it means every free generation runs a per-user scan over today's rows,
-- and 0001 only indexed generations by (job_id, revision_number desc).
--
-- No index needed on the purchases side: `unique (job_id)` from 0001 already
-- serves the `job_id in (...)` probe.

create index if not exists generations_user_created_idx
  on public.generations (user_id, created_at desc);

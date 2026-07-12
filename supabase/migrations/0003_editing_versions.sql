-- Inline editing, AI rewrites, report regeneration and milestone versioning.
--
-- The interview simulation was previously only produced transiently in the
-- funnel; persist it on each generation so the paid workspace can render and
-- regenerate it. Add per-purchase counters for the new AI actions (mirrors the
-- existing revisions_used quota).

-- The interview simulation (pitch + likely questions) for this generation.
alter table public.generations
  add column simulation jsonb;

-- Whether the persisted report (diff + simulation) is out of sync with the CV
-- after inline edits — drives the "smart download" auto-regeneration.
alter table public.generations
  add column report_stale boolean not null default false;

-- New per-flow AI-action quotas (job-scoped, like revisions_used).
alter table public.purchases
  add column rewrites_used int not null default 0,
  add column report_regens_used int not null default 0;

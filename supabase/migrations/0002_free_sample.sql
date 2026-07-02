-- One-time free sample per registered user:
-- the sample generation is shown watermarked and non-downloadable;
-- purchasing the job unlocks it.

alter table public.profiles
  add column free_sample_used boolean not null default false;

alter table public.generations
  add column is_sample boolean not null default false;

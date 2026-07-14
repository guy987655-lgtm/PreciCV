-- Persist the Results-view preferences alongside the template (PRD v2 Topic 3):
-- the CV preview background theme and the split-view layout choice, so the
-- workspace restores exactly how the user left it.

alter table public.generations
  add column cv_theme text not null default 'light',
  add column split_view boolean not null default false;

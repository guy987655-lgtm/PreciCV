-- The rest of the export configuration, remembered on the USER.
--
-- 0007 gave profiles.default_template so a returning user's DESIGN survived
-- into the next flow. The other three export settings did not: cv_theme and
-- split_view existed only per-document on generations (0004), and the
-- "AI section on/off" toggle only inside the CV JSON. So a user whose last
-- download was Ledger + dark + split got the design back and re-set everything
-- else, on every single application.
--
-- Column names mirror generations.cv_theme / split_view on purpose — the
-- seeding code in /api/generate copies straight across.
--
-- Typed columns rather than one export_prefs jsonb: /api/account/preferences
-- writes with a single upsert, and a PARTIAL patch of a jsonb column cannot be
-- expressed that way (it needs read-modify-write, i.e. a lost update whenever
-- two tabs save different settings).
--
-- NOT NULL with defaults equal to the app's own defaults, so every existing row
-- is already correct and there is nothing to backfill. Validated in code like
-- default_template, not by a check constraint.

alter table public.profiles
  add column if not exists cv_theme text not null default 'light',
  add column if not exists split_view boolean not null default false,
  add column if not exists hide_ai_section boolean not null default false;

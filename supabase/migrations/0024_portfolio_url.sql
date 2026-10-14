-- An optional portfolio link, printed on every CV as a QR code under a
-- clickable "View my portfolio" heading.
--
-- On the USER, not in the CV JSON: the tailoring call rewrites the whole
-- contact block, so a link stored there would survive only as long as the
-- model copied it faithfully. Read at render time instead, it also reaches
-- CVs generated before the user set it.
--
-- Nullable with no default: null = never set (every existing row), '' = the
-- user removed it. The two differ on purpose — a link set as a guest is pushed
-- up only into a null, never over a deliberate removal (use-portfolio-url.ts).
-- Normalized in code (normalizePortfolioUrl); the check only bounds the size.
--
-- Run BEFORE deploying the code that reads it: /api/account/preferences
-- selects this column, and a missing column fails the whole request.

alter table public.profiles
  add column if not exists portfolio_url text
    check (portfolio_url is null or char_length(portfolio_url) <= 300);

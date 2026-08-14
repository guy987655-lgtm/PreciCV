-- 0013 — the capture layer: who visited, and what they did before signing up.
--
-- Until now the product could not answer "how many people came to the site".
-- There was no visitor id of any kind, and the entire anonymous funnel — CV
-- upload, up to five job descriptions, the whole questionnaire — lived only in
-- localStorage and reached the database only if the visitor signed up. So
-- every count was a count of survivors.
--
-- Four tables fix that:
--   visitors        one durable browser, forever
--   visits          one session
--   visitor_users   the permanent visitor <-> user link
--   funnel_events   server-side milestones, including anonymous ones
--
-- ============================================================
-- WHAT THIS LAYER MUST NEVER STORE
-- ============================================================
--   jd_text            -> jd_hash, jd_chars, jd_words, and the LLM's own
--                         role/company/field extraction. Job descriptions are
--                         third-party content and often name a hiring manager.
--   raw CV text / file -> cv_chars, cv_file_ext. The CV is the single most
--                         sensitive artefact in this product.
--   answer text        -> nothing at all. Answers live only in
--                         profile_answers, where DELETE /api/answers can
--                         actually erase them.
--   email address      -> email_domain, and only in the warehouse.
--   raw IP             -> ip_hash (HMAC), plus a two-letter country.
--   raw User-Agent     -> ua_hash, plus parsed device/os/browser families.
--   full referrer URL  -> referrer_host and utm params only. A referrer path
--                         leaks the previous page's query string.
--
-- The one deliberate exception is funnel_events.question_texts; see its
-- comment below.

-- ============================================================
-- visitors: one row per durable browser
-- ============================================================
--
-- The first-touch columns are write-once by convention AND by the RPC that
-- fills them (on conflict do update touches only last_seen_at). They describe
-- where this browser came from the very first time, which is the only
-- attribution that survives a multi-visit journey.
create table if not exists public.visitors (
  visitor_id            uuid primary key,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  visit_count           integer     not null default 0,
  event_count           integer     not null default 0,

  first_landing_path    text,
  first_referrer_host   text,
  first_utm_source      text,
  first_utm_medium      text,
  first_utm_campaign    text,
  first_utm_term        text,
  first_utm_content     text,
  first_country         text,
  first_device_type     text,
  first_os_family       text,
  first_browser_family  text,
  first_lang            text,

  -- false when ANALYTICS_COOKIE_SECRET was unset and the id could not be
  -- signed. The row is kept and labelled rather than silently trusted.
  cookie_signed         boolean not null default true,
  bot_suspect           boolean not null default false,
  updated_at            timestamptz not null default now()
);

create index if not exists visitors_last_seen_idx on public.visitors (last_seen_at);
create index if not exists visitors_updated_idx   on public.visitors (updated_at);

comment on table public.visitors is
  'One durable browser. The id is minted in src/proxy.ts and lives in the specv_vid cookie for two years. Never overwritten at signup — see visitor_users.';

-- ============================================================
-- visits: one row per session
-- ============================================================
--
-- Session boundary (enforced in touch_visit, 0014): 30 minutes of inactivity,
-- a hard cut at UTC midnight, and a 12-hour cap. The midnight cut guarantees
-- every visit belongs to exactly one calendar day, which is what keeps daily
-- rollups additive — a visit that has to be split across two dates poisons
-- every one of them.
create table if not exists public.visits (
  visit_id        uuid primary key default gen_random_uuid(),
  visitor_id      uuid not null references public.visitors (visitor_id) on delete cascade,
  user_id         uuid references auth.users (id) on delete set null,

  started_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  ended_at        timestamptz,
  visit_date      date not null default ((now() at time zone 'utc')::date),

  hit_count       integer not null default 1,
  event_count     integer not null default 0,

  entry_path      text,
  referrer_host   text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  country         text,
  device_type     text,
  os_family       text,
  browser_family  text,
  lang            text,

  -- HMAC-SHA256, never the raw values. Nulled out after 90 days by the
  -- retention step.
  ip_hash         text,
  ua_hash         text,

  bot_suspect     boolean not null default false,
  -- true when an API route opened this visit instead of the page beacon.
  -- Crawlers get a cookie but never run JavaScript, so beacon-created visits
  -- are the human ones; this flag keeps the rare API-first session countable
  -- rather than invisible.
  server_created  boolean not null default false,
  signup_in_visit boolean not null default false,
  updated_at      timestamptz not null default now()
);

create index if not exists visits_visitor_open_idx on public.visits (visitor_id, last_seen_at desc);
create index if not exists visits_updated_idx      on public.visits (updated_at);
create index if not exists visits_date_idx         on public.visits (visit_date);
create index if not exists visits_user_idx         on public.visits (user_id) where user_id is not null;

-- ============================================================
-- visitor_users: the permanent link
-- ============================================================
--
-- Many visitors per user (their other devices) and many users per visitor (a
-- shared laptop), so the link is its own table rather than a column.
--
-- The partial unique index is the product decision made structural: a user has
-- EXACTLY ONE signup visitor, it is claimed once, and the database refuses to
-- let a later login move it. That is what "the user_id and the visitor_id of
-- the registration stay the same forever" means in practice — the pairing is
-- permanent, and neither id is overwritten.
create table if not exists public.visitor_users (
  visitor_id        uuid not null references public.visitors (visitor_id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  first_linked_at   timestamptz not null default now(),
  last_linked_at    timestamptz not null default now(),
  link_count        integer not null default 1,
  is_signup_visitor boolean not null default false,
  primary key (visitor_id, user_id)
);

create unique index if not exists visitor_users_signup_uidx
  on public.visitor_users (user_id) where is_signup_visitor;

create index if not exists visitor_users_user_idx on public.visitor_users (user_id);

-- ============================================================
-- funnel_events: server-side milestones
-- ============================================================
create table if not exists public.funnel_event_types (
  event_type  text primary key,
  description text not null,
  sort_order  smallint not null default 100
);

insert into public.funnel_event_types (event_type, description, sort_order) values
  ('visit_ping',            'Beacon page view',                                    10),
  ('cv_parsed',             'CV uploaded and parsed (/api/try/parse-cv)',          20),
  ('jd_submitted',          'One job description submitted',                       30),
  ('questions_served',      'Question set returned (/api/try/questions)',          40),
  ('registration_wall_hit', '401 registration_required on /api/try/generate',      50),
  ('signup_linked',         'OAuth callback linked a visitor to a user',           60),
  ('import_completed',      'Anonymous flow imported after signup',                70),
  ('account_job_created',   'Job row created for an already signed-in user',       80)
on conflict (event_type) do nothing;

create table if not exists public.funnel_events (
  event_id     bigint generated always as identity primary key,
  occurred_at  timestamptz not null default now(),
  visitor_id   uuid not null references public.visitors (visitor_id) on delete cascade,
  visit_id     uuid references public.visits (visit_id) on delete set null,
  user_id      uuid references auth.users (id) on delete set null,
  event_type   text not null references public.funnel_event_types (event_type),

  -- Job description facts. THE JD TEXT ITSELF IS NEVER STORED HERE.
  jd_hash      text,
  jd_chars     integer,
  jd_words     integer,
  role_raw     text,     -- greeting.targetJobTitle
  company_raw  text,     -- greeting.company
  field_raw    text,     -- greeting.field    (computed today and thrown away)
  same_field   boolean,  -- greeting.sameField (likewise)

  -- CV facts. THE CV TEXT IS NEVER STORED HERE.
  cv_chars     integer,
  cv_file_ext  text,

  -- Question facts.
  mcq_served   integer,
  open_served  integer,
  -- PII-BEARING, and kept anyway: LLM-generated questions can quote the user's
  -- own CV back at them. Without the set of questions that were SHOWN there is
  -- no denominator for "how many of the people asked actually answered", which
  -- is the number that drives product decisions. Retention is 180 days —
  -- shorter than the row itself — and purge_visitor_data erases it on request.
  question_texts text[],

  job_count    integer,
  http_status  integer,
  duration_ms  integer,
  props        jsonb not null default '{}'::jsonb
);

-- One JD, one row, per visit — enforced by the database rather than by app
-- logic, because two independent routes report the same submission:
-- /api/try/jd-meta re-fires on every edit of the pasted text, and
-- /api/try/questions re-sends the whole array and is retried by the client.
-- Both emit; the first writer for a (visit_id, jd_hash) wins and the rest are
-- absorbed by ON CONFLICT DO NOTHING. Instrumenting only one of them would
-- either undercount (jd-meta alone, on LLM failure) or double-count.
create unique index if not exists funnel_events_jd_dedupe_uidx
  on public.funnel_events (visit_id, jd_hash)
  where event_type = 'jd_submitted' and jd_hash is not null and visit_id is not null;

create index if not exists funnel_events_occurred_idx on public.funnel_events (occurred_at);
create index if not exists funnel_events_visitor_idx  on public.funnel_events (visitor_id, occurred_at desc);
create index if not exists funnel_events_type_idx     on public.funnel_events (event_type, occurred_at desc);
create index if not exists funnel_events_jdhash_idx   on public.funnel_events (jd_hash) where jd_hash is not null;
create index if not exists funnel_events_user_idx     on public.funnel_events (user_id) where user_id is not null;

-- ============================================================
-- deleted_user_tombstones
-- ============================================================
--
-- Once the auth.users row is gone, an incremental warehouse has no way to know
-- WHICH user_key to erase — a deleted row has no updated_at to be newer than a
-- watermark. The tombstone is how the deletion is communicated forward. It
-- holds a bare uuid and no personal data, and is itself deleted 30 days after
-- the warehouse confirms the purge.
create table if not exists public.deleted_user_tombstones (
  user_id             uuid primary key,
  deleted_at          timestamptz not null default now(),
  warehouse_purged_at timestamptz
);

-- ============================================================
-- Row Level Security: no read access for users at all
-- ============================================================
--
-- Deliberately narrower than every other table in this schema, which grant
-- "own rows". Three reasons this one grants nothing:
--
--   1. funnel_events.jd_hash is an ORACLE. With read access any signed-in user
--      could ask `where jd_hash = md5(<a job posting they have>)` and learn
--      whether anyone else ever submitted it. That is a real leak of other
--      people's activity out of a column that looks innocuous.
--   2. visitor_users would let someone enumerate every browser they have used.
--      Mildly unpleasant, zero product value.
--   3. The application never renders any of this. Read access would be pure
--      attack surface.
--
-- RLS with zero policies denies everything to anon and authenticated;
-- service_role bypasses RLS entirely. The REVOKE is what additionally removes
-- these tables from the PostgREST schema, so they 401 instead of returning an
-- empty result. Both, on purpose.
alter table public.visitors                enable row level security;
alter table public.visits                  enable row level security;
alter table public.visitor_users           enable row level security;
alter table public.funnel_events           enable row level security;
alter table public.funnel_event_types      enable row level security;
alter table public.deleted_user_tombstones enable row level security;

revoke all on public.visitors                from anon, authenticated;
revoke all on public.visits                  from anon, authenticated;
revoke all on public.visitor_users           from anon, authenticated;
revoke all on public.funnel_events           from anon, authenticated;
revoke all on public.funnel_event_types      from anon, authenticated;
revoke all on public.deleted_user_tombstones from anon, authenticated;

-- ============================================================
-- The foreign keys deferred from 0012
-- ============================================================
do $$ begin
  alter table public.jobs add constraint jobs_origin_visitor_fk
    foreign key (origin_visitor_id) references public.visitors (visitor_id) on delete set null;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.jobs add constraint jobs_origin_visit_fk
    foreign key (origin_visit_id) references public.visits (visit_id) on delete set null;
exception when duplicate_object then null; end $$;

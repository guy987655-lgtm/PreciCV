-- 0016 — the dimensions.
--
-- Conventions, applied to every table here:
--
--   Surrogate key   bigint generated always as identity, named <table>_key.
--                   Junk dimensions use integer; they are small by definition.
--   Natural key     always kept alongside as UNIQUE NOT NULL. Every upsert in
--                   the ETL targets the natural key, never the surrogate.
--   Unknown member  key -1 in every table, so a fact never carries a NULL
--                   foreign key. A NULL drops the row from every inner join,
--                   which is how a warehouse quietly loses a slice of its data.
--   etl_updated_at  on every row, so "when did this last change" is answerable
--                   without a separate audit table.
--
-- dim_question lives in 0018 with the clustering functions it depends on.
--
-- Two dimension-to-dimension references are deliberately NOT foreign keys:
-- dim_user.signup_visitor_key and dim_visitor.signup_user_key point at each
-- other, and a circular pair cannot be seeded — the first insert on either side
-- would violate the other. They are documented soft references. The integrity
-- that matters (fact -> dimension) is fully enforced in 0017.

-- ============================================================
-- dim_visitor
-- ============================================================
--
-- Grain: one durable browser.
--
-- Mixed slowly-changing behaviour, on purpose. The first_* columns are Type 0 —
-- written once and never updated, because first-touch attribution is the only
-- attribution that survives a journey spanning several visits. The rollups are
-- Type 1, overwritten on every refresh.
create table if not exists analytics.dim_visitor (
  visitor_key         bigint generated always as identity primary key,
  visitor_id          uuid not null unique,

  first_seen_at       timestamptz,
  first_seen_date_key integer not null default -1,
  last_seen_at        timestamptz,
  last_seen_date_key  integer not null default -1,

  -- Frozen at first touch.
  acquisition_key     integer not null default -1,
  device_key          integer not null default -1,
  first_country       text,

  is_identified       boolean not null default false,
  -- The account this browser CREATED, if any. Soft reference to dim_user.
  signup_user_key     bigint,
  linked_user_count   smallint not null default 0,

  visit_count         integer not null default 0,
  event_count         integer not null default 0,
  jd_submission_count integer not null default 0,
  first_jd_at         timestamptz,
  first_signup_at     timestamptz,
  first_purchase_at   timestamptz,

  cookie_signed       boolean not null default true,
  bot_suspect         boolean not null default false,
  etl_updated_at      timestamptz not null default now()
);

insert into analytics.dim_visitor (visitor_key, visitor_id)
overriding system value
values (-1, '00000000-0000-0000-0000-000000000000')
on conflict (visitor_key) do nothing;

create index if not exists dim_visitor_signup_user_idx
  on analytics.dim_visitor (signup_user_key) where signup_user_key is not null;

-- ============================================================
-- dim_user
-- ============================================================
--
-- Grain: one registered account.
--
-- signup_visitor_key / signup_visitor_id are the product requirement made
-- physical: the pairing recorded at registration never changes. The ETL writes
-- them with coalesce(existing, new) so a later refresh cannot overwrite them,
-- and the "first ever" timestamps with least(...) so they cannot move forward.
--
-- Accounts that existed before capture shipped carry signup_visitor_key = -1
-- permanently. There is no way to backfill it and inventing one would be worse
-- than admitting it is unknown.
create table if not exists analytics.dim_user (
  user_key              bigint generated always as identity primary key,
  user_id               uuid not null unique,

  -- WRITE ONCE. Never updated after the first non-null value.
  signup_visitor_key    bigint not null default -1,
  signup_visitor_id     uuid,

  auth_provider_key     integer not null default -1,
  signup_at             timestamptz,
  signup_date_key       integer not null default -1,
  -- Domain only, never the address.
  email_domain          text,

  is_onboarded          boolean not null default false,
  free_sample_used      boolean not null default false,
  default_template_key  integer not null default -1,
  cv_theme              text,
  split_view            boolean,
  hide_ai_section       boolean,
  has_cv_on_file        boolean not null default false,
  cv_uploaded_at        timestamptz,
  cv_char_count         integer not null default 0,
  dealbreaker_count     smallint not null default 0,
  additional_fact_count smallint not null default 0,

  first_job_at          timestamptz,
  first_generation_at   timestamptz,
  first_paid_at         timestamptz,
  last_activity_at      timestamptz,

  lifetime_jobs         integer not null default 0,
  lifetime_generations  integer not null default 0,
  lifetime_answers      integer not null default 0,
  lifetime_paid_cents   integer not null default 0,

  is_deleted            boolean not null default false,
  deleted_detected_at   timestamptz,
  etl_updated_at        timestamptz not null default now()
);

insert into analytics.dim_user (user_key, user_id)
overriding system value
values (-1, '00000000-0000-0000-0000-000000000000')
on conflict (user_key) do nothing;

-- ============================================================
-- dim_company + dim_company_alias
-- ============================================================
--
-- Grain: one canonical hiring company.
--
-- company_norm (the output of analytics.norm_company) is the natural key, so a
-- company's surrogate key is stable for as long as its normalized spelling is.
create table if not exists analytics.dim_company (
  company_key        bigint generated always as identity primary key,
  company_norm       text not null unique,
  -- The most frequently seen raw spelling, for display. Type 1.
  company_display    text,
  -- Soft-suffix-stripped. Used ONLY by the merge-suggestion query, never as a
  -- key: auto-merging on it would silently fuse "Alphabet" and "Alphabet Labs".
  company_norm_loose text,

  raw_variant_count  integer not null default 0,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  submission_count   integer not null default 0,
  job_count          integer not null default 0,
  distinct_user_count integer not null default 0,

  is_unknown         boolean not null default false,
  -- Human override. A merge is one UPDATE and applies retroactively across all
  -- history without rewriting a single fact row.
  merged_into_key    bigint references analytics.dim_company (company_key),
  curated            boolean not null default false,
  etl_updated_at     timestamptz not null default now()
);

insert into analytics.dim_company (company_key, company_norm, company_display, is_unknown)
overriding system value
values (-1, '(unknown)', '(unknown)', true)
on conflict (company_key) do nothing;

create index if not exists dim_company_loose_idx
  on analytics.dim_company (company_norm_loose) where merged_into_key is null;

-- Every distinct raw string ever seen, and where it was routed.
--
-- This is the escape hatch that makes the company dimension trustworthy. String
-- normalization cannot fix abbreviations (ibm / international business
-- machines), transliteration (wix / ויקס — guaranteed in Israeli postings),
-- subsidiaries (google / youtube), or typos. A human alias row can fix all four,
-- and the ETL will never overwrite one.
create table if not exists analytics.dim_company_alias (
  raw_hash         text primary key,
  raw_text         text not null,
  company_key      bigint not null references analytics.dim_company (company_key),
  source           text not null default 'auto' check (source in ('auto', 'human')),
  first_seen_at    timestamptz not null default now(),
  occurrence_count integer not null default 0
);

create index if not exists dim_company_alias_key_idx
  on analytics.dim_company_alias (company_key);

-- ============================================================
-- dim_role + dim_role_alias
-- ============================================================
--
-- Grain: one canonical job title.
create table if not exists analytics.dim_role (
  role_key         bigint generated always as identity primary key,
  role_norm        text not null unique,
  role_display     text,
  -- Seniority words removed: "senior data analyst" -> "data analyst", so the
  -- same job at three levels is one row here and three seniority values.
  role_core_norm   text,
  seniority        text not null default 'unspecified'
                   check (seniority in ('intern','junior','mid','senior','lead',
                                        'staff','principal','head','director',
                                        'vp','c_level','unspecified')),
  seniority_rank   smallint not null default 0,
  role_family      text not null default 'unknown',

  is_unknown       boolean not null default false,
  first_seen_at    timestamptz,
  last_seen_at     timestamptz,
  submission_count integer not null default 0,
  merged_into_key  bigint references analytics.dim_role (role_key),
  curated          boolean not null default false,
  etl_updated_at   timestamptz not null default now()
);

insert into analytics.dim_role (role_key, role_norm, role_display, is_unknown)
overriding system value
values (-1, '(unknown)', '(unknown)', true)
on conflict (role_key) do nothing;

create index if not exists dim_role_core_idx   on analytics.dim_role (role_core_norm);
create index if not exists dim_role_family_idx on analytics.dim_role (role_family, seniority_rank);

create table if not exists analytics.dim_role_alias (
  raw_hash         text primary key,
  raw_text         text not null,
  role_key         bigint not null references analytics.dim_role (role_key),
  source           text not null default 'auto' check (source in ('auto', 'human')),
  first_seen_at    timestamptz not null default now(),
  occurrence_count integer not null default 0
);

create index if not exists dim_role_alias_key_idx on analytics.dim_role_alias (role_key);

-- ============================================================
-- dim_field
-- ============================================================
--
-- Grain: one professional field label, from greeting.field.
--
-- The LLM already produces this on every job description and /api/try/jd-meta
-- throws it away before responding. Capturing it in the funnel event costs one
-- line and yields the only industry-shaped dimension this product can produce
-- without a second model call — so it exists here, and it will be empty for any
-- job that only ever arrived through the account path.
create table if not exists analytics.dim_field (
  field_key        bigint generated always as identity primary key,
  field_norm       text not null unique,
  field_display    text,
  is_unknown       boolean not null default false,
  first_seen_at    timestamptz,
  submission_count integer not null default 0,
  etl_updated_at   timestamptz not null default now()
);

insert into analytics.dim_field (field_key, field_norm, field_display, is_unknown)
overriding system value
values (-1, '(unknown)', '(unknown)', true)
on conflict (field_key) do nothing;

-- ============================================================
-- dim_run
-- ============================================================
--
-- Grain: one batch of jobs submitted together (jobs.batch_id).
--
-- The feature is called a "run" in the product; the column kept its original
-- name through the rename, and so does the natural key here.
create table if not exists analytics.dim_run (
  run_key          bigint generated always as identity primary key,
  batch_id         uuid not null unique,
  user_key         bigint not null default -1,
  job_count        smallint not null default 0,
  created_at       timestamptz,
  created_date_key integer not null default -1,
  is_multi_job     boolean not null default false,
  source           text not null default 'unknown',
  etl_updated_at   timestamptz not null default now()
);

insert into analytics.dim_run (run_key, batch_id)
overriding system value
values (-1, '00000000-0000-0000-0000-000000000000')
on conflict (run_key) do nothing;

-- ============================================================
-- dim_job
-- ============================================================
--
-- Grain: one row in public.jobs.
--
-- Deliberately a dimension rather than only a fact. Three facts describe a job
-- from different angles — its submission, its generations, its purchase — and
-- they all need to filter on the same job attributes. The submission EVENT is
-- fact_jd_submission; this is the thing the event is about.
create table if not exists analytics.dim_job (
  job_key              bigint generated always as identity primary key,
  job_id               uuid not null unique,
  user_key             bigint not null default -1,
  run_key              bigint not null default -1,
  company_key          bigint not null default -1,
  role_key             bigint not null default -1,

  jd_hash              text,
  jd_char_count        integer not null default 0,
  jd_word_count        integer not null default 0,

  status               text,
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  has_display_name     boolean not null default false,
  dealbreaker_hit_count smallint not null default 0,

  -- The browser whose anonymous funnel produced this job, when known.
  origin_visitor_key   bigint not null default -1,

  created_at           timestamptz,
  created_date_key     integer not null default -1,
  first_generation_at  timestamptz,
  generation_count     smallint not null default 0,
  max_revision_number  smallint not null default 0,
  is_purchased         boolean not null default false,
  etl_updated_at       timestamptz not null default now()
);

insert into analytics.dim_job (job_key, job_id)
overriding system value
values (-1, '00000000-0000-0000-0000-000000000000')
on conflict (job_key) do nothing;

create index if not exists dim_job_user_idx    on analytics.dim_job (user_key);
create index if not exists dim_job_company_idx on analytics.dim_job (company_key);
create index if not exists dim_job_jdhash_idx  on analytics.dim_job (jd_hash) where jd_hash is not null;

-- ============================================================
-- dim_template — static, mirrors CV_TEMPLATES in src/lib/types.ts
-- ============================================================
create table if not exists analytics.dim_template (
  template_key  integer generated always as identity primary key,
  template_code text not null unique,
  display_name  text not null,
  sort_order    smallint not null default 100
);

insert into analytics.dim_template (template_key, template_code, display_name, sort_order)
overriding system value
values (-1, '(unknown)', '(unknown)', 999)
on conflict (template_key) do nothing;

insert into analytics.dim_template (template_code, display_name, sort_order)
select t.code, initcap(t.code), t.ord
from (values
  ('classic',1),('modern',2),('compact',3),('executive',4),('elegant',5),
  ('technical',6),('contemporary',7),('minimal',8),('onyx',9),('midnight',10),
  ('ledger',11),('index',12),('masthead',13),('marginalia',14),('panel',15),
  ('columnrule',16),('rail',17),('grid',18),('timeline',19),('specsheet',20),
  ('mono',21)
) as t(code, ord)
on conflict (template_code) do nothing;

-- ============================================================
-- dim_sku — static, mirrors PACK_PRICE_CENTS in src/lib/packs.ts
-- ============================================================
--
-- list_cents is the strike-through anchor (single price x quantity);
-- price_cents is what is actually charged. Storing both means the discount is a
-- column rather than a formula every query has to remember.
create table if not exists analytics.dim_sku (
  sku_key      integer generated always as identity primary key,
  sku          text not null unique,
  tier         text not null default 'full',
  pack_qty     smallint not null default 0,
  list_cents   integer not null default 0,
  price_cents  integer not null default 0,
  saving_cents integer not null default 0,
  saving_pct   smallint not null default 0
);

insert into analytics.dim_sku (sku_key, sku, tier, pack_qty)
overriding system value
values (-1, '(unknown)', 'full', 0)
on conflict (sku_key) do nothing;

insert into analytics.dim_sku (sku, tier, pack_qty, list_cents, price_cents, saving_cents, saving_pct)
select
  'full_x' || q.qty,
  'full',
  q.qty::smallint,
  400 * q.qty,
  q.price,
  400 * q.qty - q.price,
  round(100.0 * (400 * q.qty - q.price) / (400 * q.qty))::smallint
from (values (1,400),(2,600),(3,800),(4,900),(5,1000)) as q(qty, price)
on conflict (sku) do nothing;

-- ============================================================
-- dim_auth_provider — static
-- ============================================================
create table if not exists analytics.dim_auth_provider (
  auth_provider_key integer generated always as identity primary key,
  provider          text not null unique,
  display_name      text not null
);

insert into analytics.dim_auth_provider (auth_provider_key, provider, display_name)
overriding system value
values (-1, '(unknown)', '(unknown)')
on conflict (auth_provider_key) do nothing;

insert into analytics.dim_auth_provider (provider, display_name) values
  ('google', 'Google'),
  ('linkedin_oidc', 'LinkedIn'),
  ('github', 'GitHub'),
  ('email', 'Email')
on conflict (provider) do nothing;

-- ============================================================
-- dim_acquisition — junk dimension
-- ============================================================
--
-- Grain: one distinct combination of referrer, UTM tags and landing path.
--
-- A junk dimension rather than six columns on fact_visit: the combinations are
-- few and highly repetitive, and collapsing them to one integer keeps the fact
-- table narrow while making "direct vs AI vs paid search" a group-by instead of
-- a CASE expression rewritten in every query.
create table if not exists analytics.dim_acquisition (
  acquisition_key integer generated always as identity primary key,
  acq_hash        text not null unique,
  referrer_host   text,
  referrer_type   text not null default 'direct',
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_term        text,
  utm_content     text,
  landing_path    text,
  landing_section text,
  is_direct       boolean not null default false,
  is_paid_hint    boolean not null default false,
  etl_updated_at  timestamptz not null default now()
);

insert into analytics.dim_acquisition (acquisition_key, acq_hash, referrer_type, is_direct)
overriding system value
values (-1, '(unknown)', 'direct', true)
on conflict (acquisition_key) do nothing;

-- ============================================================
-- dim_device — junk dimension
-- ============================================================
--
-- Grain: one distinct combination of device attributes.
--
-- Everything here is derived from a User-Agent that is itself never stored;
-- the capture layer keeps only these buckets and a hash. Country rides along
-- because it has the same cardinality behaviour and is always known at the same
-- moment.
create table if not exists analytics.dim_device (
  device_key     integer generated always as identity primary key,
  device_hash    text not null unique,
  device_type    text not null default 'unknown',
  os_family      text not null default 'unknown',
  browser_family text not null default 'unknown',
  lang_primary   text,
  country        text,
  is_bot_suspect boolean not null default false,
  etl_updated_at timestamptz not null default now()
);

insert into analytics.dim_device (device_key, device_hash)
overriding system value
values (-1, '(unknown)')
on conflict (device_key) do nothing;

grant all on all tables in schema analytics to service_role;
grant all on all sequences in schema analytics to service_role;

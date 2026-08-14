-- 0018 — the fact tables.
--
-- Every table below states its grain in one sentence. Grain is the one decision
-- that cannot be cheaply reversed, so it is set by the question the table has to
-- answer, not by which rows happen to be complete.
--
-- Measures carry their additivity in a column comment. That is not decoration:
-- a match score is an average, a credit balance may be summed across users but
-- never across dates, and a running counter is a snapshot. The comment is the
-- only thing standing between a future dashboard and a number that is wrong in
-- a way nobody notices.
--
-- Every foreign key here is declared and enforced. Facts point at dimensions;
-- dimension keys default to -1 (the unknown member) rather than NULL, so an
-- inner join can never silently drop a row.

-- ============================================================
-- fact_visit
-- ============================================================
--
-- Grain: one visit — a single browser session by one visitor, bounded by 30
-- minutes of inactivity, a UTC-midnight cut, or a 12-hour cap.
create table if not exists analytics.fact_visit (
  visit_key       bigint generated always as identity primary key,
  visit_id        uuid not null unique,

  date_key        integer not null default -1 references analytics.dim_date (date_key),
  visitor_key     bigint  not null default -1 references analytics.dim_visitor (visitor_key),
  user_key        bigint  not null default -1 references analytics.dim_user (user_key),
  acquisition_key integer not null default -1 references analytics.dim_acquisition (acquisition_key),
  device_key      integer not null default -1 references analytics.dim_device (device_key),

  occurred_at     timestamptz,
  visit_ended_at  timestamptz,
  hour_of_day_utc smallint,
  entry_path      text,

  visit_count                smallint not null default 1,
  page_hit_count             integer  not null default 0,
  event_count                integer  not null default 0,
  duration_seconds           integer  not null default 0,
  jd_submitted_count         integer  not null default 0,
  is_bounce                  boolean  not null default false,
  is_first_visit_for_visitor boolean  not null default false,
  converted_to_signup        boolean  not null default false,
  bot_suspect                boolean  not null default false,
  server_created             boolean  not null default false,

  etl_updated_at  timestamptz not null default now()
);

create index if not exists fact_visit_date_idx    on analytics.fact_visit (date_key);
create index if not exists fact_visit_visitor_idx on analytics.fact_visit (visitor_key);
create index if not exists fact_visit_user_idx    on analytics.fact_visit (user_key) where user_key <> -1;

comment on column analytics.fact_visit.duration_seconds is
  'ADDITIVE (sum = total time on site). Truncated at the last beacon ping, so the final page''s dwell time is invisible. Standard limitation — stated, not hidden.';
comment on column analytics.fact_visit.bot_suspect is
  'A FILTER, not a measure. Visits are only created by the page beacon, so crawlers rarely appear at all; this catches the rest.';

-- ============================================================
-- fact_jd_submission — "how many jobs were uploaded"
-- ============================================================
--
-- Grain: one job description submitted to the product at one moment by one
-- visitor. Anonymous funnel pastes and account job rows live in the SAME table,
-- because the business question ("how many jobs were uploaded, for what roles,
-- by how many companies") does not care which side of the signup wall the job
-- arrived on — and counting only the account side would report survivors.
create table if not exists analytics.fact_jd_submission (
  submission_key bigint generated always as identity primary key,
  -- 'fe:<event_id>' or 'job:<uuid>' — one row per source record, idempotently.
  submission_id  text not null unique,

  date_key    integer not null default -1 references analytics.dim_date (date_key),
  visitor_key bigint  not null default -1 references analytics.dim_visitor (visitor_key),
  user_key    bigint  not null default -1 references analytics.dim_user (user_key),
  company_key bigint  not null default -1 references analytics.dim_company (company_key),
  role_key    bigint  not null default -1 references analytics.dim_role (role_key),
  field_key   bigint  not null default -1 references analytics.dim_field (field_key),
  run_key     bigint  not null default -1 references analytics.dim_run (run_key),
  job_key     bigint  not null default -1 references analytics.dim_job (job_key),

  occurred_at timestamptz,
  -- try_jd_meta | try_questions | account_import | account_other
  source      text not null default 'unknown',
  jd_hash     text,

  submission_count        smallint not null default 1,
  jd_char_count           integer  not null default 0,
  jd_word_count           integer  not null default 0,
  is_anonymous            boolean  not null default false,
  became_account_job      boolean  not null default false,
  has_company             boolean  not null default false,
  has_role                boolean  not null default false,
  same_field              boolean,
  seconds_to_account_job  integer,
  is_first_for_visitor_jd boolean  not null default false,

  etl_updated_at timestamptz not null default now()
);

create index if not exists fact_jd_date_idx    on analytics.fact_jd_submission (date_key);
create index if not exists fact_jd_visitor_idx on analytics.fact_jd_submission (visitor_key, jd_hash);
create index if not exists fact_jd_company_idx on analytics.fact_jd_submission (company_key);
create index if not exists fact_jd_role_idx    on analytics.fact_jd_submission (role_key);

comment on column analytics.fact_jd_submission.is_first_for_visitor_jd is
  'THE HOUSE RULE. "Jobs uploaded" always means count(*) FILTER (WHERE is_first_for_visitor_jd). True on exactly one row per (visitor_key, jd_hash) — AND unconditionally true when visitor_key = -1 or jd_hash is null, because the dedupe only exists to merge one person''s anonymous paste with the account job it became, and an unknown visitor is not evidence that two rows are the same submission. A job pasted anonymously and then imported after signup produces two rows, both true and both wanted (one measures funnel volume, the other conversion), so a raw count(*) counts SUBMISSION EVENTS — a different and also useful number. Confusing the two is the likeliest way this warehouse produces a wrong headline figure.';
comment on column analytics.fact_jd_submission.seconds_to_account_job is
  'NON-ADDITIVE. Average only. NULL when the submission never became an account job.';

-- ============================================================
-- fact_generation
-- ============================================================
--
-- Grain: one row in public.generations — one revision of one tailored CV for
-- one job.
create table if not exists analytics.fact_generation (
  generation_key bigint generated always as identity primary key,
  generation_id  uuid not null unique,

  date_key     integer not null default -1 references analytics.dim_date (date_key),
  user_key     bigint  not null default -1 references analytics.dim_user (user_key),
  job_key      bigint  not null default -1 references analytics.dim_job (job_key),
  company_key  bigint  not null default -1 references analytics.dim_company (company_key),
  role_key     bigint  not null default -1 references analytics.dim_role (role_key),
  run_key      bigint  not null default -1 references analytics.dim_run (run_key),
  template_key integer not null default -1 references analytics.dim_template (template_key),

  occurred_at     timestamptz,
  source_updated_at timestamptz,
  revision_number smallint not null default 0,
  is_sample       boolean not null default false,
  report_stale    boolean not null default false,
  cv_theme        text,
  split_view      boolean,

  generation_count       smallint not null default 1,
  match_score            smallint,
  match_score_is_missing boolean not null default false,
  cv_char_estimate       integer not null default 0,
  over_one_page          boolean not null default false,
  change_count           integer not null default 0,
  changes_added          integer not null default 0,
  changes_removed        integer not null default 0,
  changes_modified       integer not null default 0,
  changes_reordered      integer not null default 0,
  strength_count         integer not null default 0,
  gap_count              integer not null default 0,
  recommendation_count   integer not null default 0,
  sim_question_count     integer not null default 0,
  sim_pitch_chars        integer not null default 0,
  section_count          integer not null default 0,
  item_count             integer not null default 0,
  bullet_count           integer not null default 0,
  skill_count            integer not null default 0,
  hidden_section_count   integer not null default 0,
  seconds_since_job_created integer,
  is_first_revision      boolean not null default false,

  etl_updated_at timestamptz not null default now()
);

create index if not exists fact_generation_date_idx on analytics.fact_generation (date_key);
create index if not exists fact_generation_job_idx  on analytics.fact_generation (job_key);
create index if not exists fact_generation_user_idx on analytics.fact_generation (user_key);

comment on column analytics.fact_generation.match_score is
  'NON-ADDITIVE. Average only, and never sum. NULL when the model omitted gapAnalysis — see match_score_is_missing.';
comment on column analytics.fact_generation.match_score_is_missing is
  'TailoredCv''s zod schema defaults matchScore to 0, so a raw 0 usually means "the model omitted it", not "terrible fit". This is true when the score was 0 AND strengths and gaps were both empty — the documented failure path in src/lib/llm.ts. In that case match_score is stored as NULL so avg() is not dragged toward zero. A 0 with populated strengths/gaps is a genuine zero and is kept.';
comment on column analytics.fact_generation.cv_char_estimate is
  'NON-ADDITIVE (a per-document attribute). Average, do not sum. over_one_page compares it against ONE_PAGE_CHAR_BUDGET = 3600.';

-- ============================================================
-- fact_answer
-- ============================================================
--
-- Grain: one row in public.profile_answers — one (user, raw question text) pair
-- as it currently stands.
--
-- "As it currently stands" is doing real work in that sentence. profile_answers
-- is upserted on (user_id, question), so there is NO answer history: created_at
-- is the first answer, updated_at the latest revision, and every intermediate
-- value is gone. is_revised and seconds_first_to_last are the only remaining
-- signal, and they are recorded rather than the loss being averaged over.
create table if not exists analytics.fact_answer (
  answer_key bigint generated always as identity primary key,
  answer_id  uuid not null unique,

  date_key         integer not null default -1 references analytics.dim_date (date_key),
  updated_date_key integer not null default -1 references analytics.dim_date (date_key),
  user_key         bigint  not null default -1 references analytics.dim_user (user_key),
  question_key     bigint  not null default -1 references analytics.dim_question (question_key),
  source_job_key   bigint  not null default -1 references analytics.dim_job (job_key),

  -- The DURABLE link to the question dimension. question_key can be re-derived
  -- from this if the clustering is ever rebuilt; the raw text is the fact's real
  -- identity, the cluster is an interpretation of it.
  question_variant_hash text not null,

  occurred_at timestamptz,
  updated_at  timestamptz,
  kind        text,
  topic       text,

  answer_count           smallint not null default 1,
  answer_char_count      integer  not null default 0,
  selected_option_count  smallint not null default 0,
  offered_option_count   smallint not null default 0,
  used_other_option      boolean  not null default false,
  is_ranked              boolean  not null default false,
  is_revised             boolean  not null default false,
  seconds_first_to_last  integer,

  etl_updated_at timestamptz not null default now()
);

create index if not exists fact_answer_user_idx     on analytics.fact_answer (user_key);
create index if not exists fact_answer_question_idx on analytics.fact_answer (question_key);
create index if not exists fact_answer_variant_idx  on analytics.fact_answer (question_variant_hash);

comment on table analytics.fact_answer is
  'No answer history exists upstream (profile_answers is upserted on (user_id, question)). Skipped questions leave no trace at all — every server write path filters out empty answers, and skippedIds lives only in localStorage. source_job_key identifies the RUN, not the job that asked: /api/try/import writes jobIds[0] onto every answer in a batch.';

-- ============================================================
-- fact_user_question — the "which users answered which question" table
-- ============================================================
--
-- Grain: one (registered user, canonical question) pair that the user has
-- answered at least once.
--
-- Separate from fact_answer on purpose. fact_answer is at raw-text grain; a
-- single user can answer two differently-worded questions that cluster to the
-- same canonical one, and collapsing that here is the whole point. Making one
-- table serve both grains is the classic star-schema mistake — it would either
-- double-count users per question or lose the per-wording detail.
create table if not exists analytics.fact_user_question (
  user_question_key bigint generated always as identity primary key,
  user_key          bigint not null references analytics.dim_user (user_key),
  question_key      bigint not null references analytics.dim_question (question_key),

  first_date_key integer not null default -1 references analytics.dim_date (date_key),
  last_date_key  integer not null default -1 references analytics.dim_date (date_key),

  answered_flag              smallint not null default 1,
  variant_count              smallint not null default 1,
  total_answer_chars         integer  not null default 0,
  has_mcq_answer             boolean  not null default false,
  has_open_answer            boolean  not null default false,
  first_answered_at          timestamptz,
  last_answered_at           timestamptz,
  days_between_first_and_last integer not null default 0,

  etl_updated_at timestamptz not null default now(),
  unique (user_key, question_key)
);

create index if not exists fact_user_question_q_idx on analytics.fact_user_question (question_key);

comment on column analytics.fact_user_question.answered_flag is
  'ADDITIVE. sum() over users = how many users answered this question. This is the measure behind the headline question table.';

-- ============================================================
-- fact_question_exposure — the denominator
-- ============================================================
--
-- Grain: one (canonical question, questions_served event) — the question was
-- SHOWN to this visitor at this moment.
--
-- Without it you can count who answered a question but never who declined it,
-- because a skipped question leaves no row anywhere upstream. This turns
-- "12 users answered" into "12 of 47", which is the number that actually drives
-- a decision about whether to keep asking.
create table if not exists analytics.fact_question_exposure (
  exposure_key bigint generated always as identity primary key,
  -- '<event_id>:<md5(question text)>' — idempotent per served question.
  exposure_id  text not null unique,

  date_key     integer not null default -1 references analytics.dim_date (date_key),
  visitor_key  bigint  not null default -1 references analytics.dim_visitor (visitor_key),
  user_key     bigint  not null default -1 references analytics.dim_user (user_key),
  question_key bigint  not null default -1 references analytics.dim_question (question_key),

  question_variant_hash text not null,
  occurred_at           timestamptz,

  served_count            smallint not null default 1,
  was_answered_within_30d boolean  not null default false,

  etl_updated_at timestamptz not null default now()
);

create index if not exists fact_exposure_question_idx on analytics.fact_question_exposure (question_key);
create index if not exists fact_exposure_date_idx     on analytics.fact_question_exposure (date_key);

comment on column analytics.fact_question_exposure.was_answered_within_30d is
  'SEMI-ADDITIVE, latest-value semantics: recomputed on every refresh rather than frozen at load time.';

-- ============================================================
-- fact_order
-- ============================================================
--
-- Grain: one row in public.orders — one bundle purchase attempt.
create table if not exists analytics.fact_order (
  order_key bigint generated always as identity primary key,
  order_id  uuid not null unique,

  date_key integer not null default -1 references analytics.dim_date (date_key),
  user_key bigint  not null default -1 references analytics.dim_user (user_key),
  sku_key  integer not null default -1 references analytics.dim_sku (sku_key),

  occurred_at       timestamptz,
  source_updated_at timestamptz,
  status            text,
  tier              text,
  -- Whether a payment provider was involved. The reference itself is never
  -- copied into the warehouse.
  provider_ref_present boolean not null default false,

  order_count          smallint not null default 1,
  amount_cents         integer  not null default 0,
  upgrade_amount_cents integer  not null default 0,
  credits_total        smallint not null default 0,
  credits_spent        smallint not null default 0,
  credits_remaining    smallint not null default 0,
  is_paid              boolean  not null default false,
  is_pending           boolean  not null default false,
  is_refunded          boolean  not null default false,
  seconds_to_paid      integer,

  etl_updated_at timestamptz not null default now()
);

create index if not exists fact_order_date_idx on analytics.fact_order (date_key);
create index if not exists fact_order_user_idx on analytics.fact_order (user_key);

comment on column analytics.fact_order.credits_remaining is
  'SEMI-ADDITIVE. Sum across users on ONE date to get outstanding credit liability; never sum across dates. Derived, exactly as src/lib/credits.ts derives it — credits_total minus the purchases pointing at this order.';
comment on column analytics.fact_order.is_pending is
  'Abandoned checkouts leave status=pending rows forever — nothing in the codebase sweeps them, and nothing ever writes status=refunded either. This number will look alarming until someone adds a sweeper. Say so before anyone debugs it twice.';

-- ============================================================
-- fact_purchase
-- ============================================================
--
-- Grain: one row in public.purchases — one job unlock.
--
-- order_key is nullable and NOT a foreign key to fact_order: a purchase that
-- predates bundles, or a free-mode grant, legitimately has no order, and
-- inventing an unknown member inside a fact table to model that would be worse
-- than a NULL that means exactly what it says.
create table if not exists analytics.fact_purchase (
  purchase_key bigint generated always as identity primary key,
  purchase_id  uuid not null unique,

  date_key    integer not null default -1 references analytics.dim_date (date_key),
  user_key    bigint  not null default -1 references analytics.dim_user (user_key),
  job_key     bigint  not null default -1 references analytics.dim_job (job_key),
  company_key bigint  not null default -1 references analytics.dim_company (company_key),
  role_key    bigint  not null default -1 references analytics.dim_role (role_key),
  sku_key     integer not null default -1 references analytics.dim_sku (sku_key),
  order_key   bigint,
  order_id    uuid,

  occurred_at       timestamptz,
  source_updated_at timestamptz,
  status            text,
  tier              text,

  purchase_count        smallint not null default 1,
  amount_cents          integer  not null default 0,
  is_paid               boolean  not null default false,
  is_credit_spend       boolean  not null default false,
  is_free_mode_grant    boolean  not null default false,
  is_direct_purchase    boolean  not null default false,
  is_abandoned_checkout boolean  not null default false,
  revisions_used        smallint not null default 0,
  rewrites_used         smallint not null default 0,
  report_regens_used    smallint not null default 0,

  etl_updated_at timestamptz not null default now()
);

create index if not exists fact_purchase_date_idx  on analytics.fact_purchase (date_key);
create index if not exists fact_purchase_user_idx  on analytics.fact_purchase (user_key);
create index if not exists fact_purchase_order_idx on analytics.fact_purchase (order_key) where order_key is not null;

comment on column analytics.fact_purchase.amount_cents is
  'ADDITIVE, but NOT revenue on its own. Zero means three different things: a credit spent against a bundle (order_id present), a free-mode grant (NEXT_PUBLIC_FREE_MODE, currently on), or a genuinely free unlock. Real bundle revenue lives on fact_order.amount_cents. Use the is_* flags, which encode the disambiguation once, here, instead of re-deriving it per query.';
comment on column analytics.fact_purchase.revisions_used is
  'SEMI-ADDITIVE. A running counter on the source row: summing across purchases is fine, summing the same purchase across dates is not. Snapshot semantics — latest value wins on each refresh.';

-- ============================================================
-- fact_signup
-- ============================================================
--
-- Grain: one registered account, recorded once.
--
-- acquisition_key is the visitor's FIRST touch, not the last: the question this
-- table answers is "what brought this person to the product", and the referrer
-- on the session where they happened to click sign-in is not that.
create table if not exists analytics.fact_signup (
  signup_key bigint generated always as identity primary key,
  user_id    uuid not null unique,

  date_key           integer not null default -1 references analytics.dim_date (date_key),
  user_key           bigint  not null default -1 references analytics.dim_user (user_key),
  signup_visitor_key bigint  not null default -1 references analytics.dim_visitor (visitor_key),
  acquisition_key    integer not null default -1 references analytics.dim_acquisition (acquisition_key),
  device_key         integer not null default -1 references analytics.dim_device (device_key),
  auth_provider_key  integer not null default -1 references analytics.dim_auth_provider (auth_provider_key),

  occurred_at timestamptz,

  signup_count                      smallint not null default 1,
  seconds_first_visit_to_signup     integer,
  visits_before_signup              integer  not null default 0,
  jd_submissions_before_signup      integer  not null default 0,
  hit_registration_wall_before_signup boolean not null default false,
  jobs_in_first_run                 smallint not null default 0,
  had_anonymous_funnel              boolean  not null default false,

  etl_updated_at timestamptz not null default now()
);

create index if not exists fact_signup_date_idx on analytics.fact_signup (date_key);

comment on column analytics.fact_signup.signup_visitor_key is
  'The permanent pairing. -1 for every account created before visitor capture shipped — unbackfillable, and an invented value would be worse than an honest unknown.';

-- ============================================================
-- fact_user_day — periodic snapshot
-- ============================================================
--
-- Grain: one registered user per calendar date, dense from signup through today.
--
-- Additive daily deltas sit beside semi-additive balances in the same row, and
-- that combination is the point: one table answers both "how much was paid in
-- March" (sum the delta over the month) and "what was the outstanding credit
-- liability on 3 March" (sum the balance for that one date). Splitting them into
-- two tables would make every trend query a union.
create table if not exists analytics.fact_user_day (
  user_day_key bigint generated always as identity primary key,
  user_key     bigint  not null references analytics.dim_user (user_key),
  date_key     integer not null references analytics.dim_date (date_key),

  -- ADDITIVE deltas: safe to sum across users AND dates.
  jobs_created        integer not null default 0,
  generations_created integer not null default 0,
  revisions_created   integer not null default 0,
  answers_added       integer not null default 0,
  answers_revised     integer not null default 0,
  purchases_paid      integer not null default 0,
  cents_paid          integer not null default 0,
  orders_paid         integer not null default 0,
  credits_purchased   integer not null default 0,
  credits_spent       integer not null default 0,
  visits              integer not null default 0,
  jd_submissions      integer not null default 0,

  -- SEMI-ADDITIVE balances: sum across users on one date only.
  credits_remaining      integer not null default 0,
  cum_jobs               integer not null default 0,
  cum_generations        integer not null default 0,
  cum_answers            integer not null default 0,
  cum_distinct_questions integer not null default 0,
  cum_cents_paid         integer not null default 0,
  cum_purchases          integer not null default 0,

  -- NON-ADDITIVE state.
  days_since_signup       integer not null default 0,
  is_active_today         boolean not null default false,
  days_since_last_activity integer,
  lifecycle_stage         text not null default 'new',

  etl_updated_at timestamptz not null default now(),
  unique (user_key, date_key)
);

create index if not exists fact_user_day_date_idx on analytics.fact_user_day (date_key);

comment on column analytics.fact_user_day.credits_remaining is
  'SEMI-ADDITIVE. Sum across users within a single date; summing across dates counts the same credit once per day it sat unused.';
comment on column analytics.fact_user_day.cum_cents_paid is
  'SEMI-ADDITIVE running total. For "revenue in a period" use the cents_paid delta instead.';

grant all on all tables in schema analytics to service_role;
grant all on all sequences in schema analytics to service_role;

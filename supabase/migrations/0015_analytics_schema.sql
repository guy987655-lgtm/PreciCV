-- 0015 — the analytics schema: ground floor.
--
-- The warehouse lives in the same Postgres instance as the OLTP tables, in its
-- own schema, and is never exposed to PostgREST. At this data volume that is
-- strictly better than a separate warehouse: no extract, no sync lag, no second
-- bill, and the ETL is plain SQL that can join OLTP to dimensions directly.
--
-- This file installs only what everything else depends on:
--   the schema and its lockdown
--   ETL bookkeeping (watermarks + a run log)
--   dim_date
--   the normalization functions for company names and job titles
--
-- Nothing here reads application data, so it is safe to run before any of it
-- exists, and safe to run twice.

create schema if not exists analytics;

-- ============================================================
-- Lockdown
-- ============================================================
--
-- Supabase exposes public / graphql_public / storage to PostgREST and nothing
-- else, so `analytics` is already invisible over HTTP. The revokes are belt and
-- braces: if someone later adds this schema to the exposed list by accident,
-- the grants still say no.
--
-- ALTER DEFAULT PRIVILEGES applies to objects created AFTER it by the same
-- role, which is why it runs here rather than at the end of 0017.
revoke all on schema analytics from public;
grant usage on schema analytics to service_role;

alter default privileges in schema analytics grant all on tables to service_role;
alter default privileges in schema analytics grant all on sequences to service_role;
alter default privileges in schema analytics grant execute on functions to service_role;

-- ============================================================
-- ETL bookkeeping
-- ============================================================
--
-- One row per step, not per run: the watermark is a position, and the counters
-- beside it are the last-run diagnostics. consecutive_failures is what turns a
-- silently broken step into something a single query can find — a warehouse
-- whose numbers are eight days stale looks exactly like a warehouse whose
-- numbers are correct, right up until someone acts on them.
create table if not exists analytics.etl_watermark (
  step_name            text primary key,
  last_value           timestamptz not null default '-infinity',
  last_run_at          timestamptz,
  last_row_count       bigint  default 0,
  last_duration_ms     integer,
  last_error           text,
  consecutive_failures integer not null default 0
);

create table if not exists analytics.etl_run_log (
  run_id       bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- running | ok | partial | failed | skipped_locked
  status       text,
  steps_ok     integer default 0,
  steps_failed integer default 0,
  detail       jsonb not null default '{}'::jsonb
);

create index if not exists etl_run_log_started_idx
  on analytics.etl_run_log (started_at desc);

-- ============================================================
-- dim_date
-- ============================================================
--
-- Grain: one calendar day.
--
-- The key is the smart integer YYYYMMDD rather than a surrogate. This is the
-- one place a smart key earns itself: date_key >= 20260101 is a readable,
-- index-friendly predicate, and a date can never be reassigned the way a
-- company or a question can.
--
-- Deliberately NO is_future / is_today column. A stored flag about "now" is
-- wrong from the moment it is written; callers compare full_date to
-- current_date instead.
create table if not exists analytics.dim_date (
  date_key           integer primary key,
  full_date          date not null unique,
  year               smallint not null,
  quarter            smallint not null,
  month              smallint not null,
  month_name         text not null,
  day_of_month       smallint not null,
  -- ISO: 1 = Monday .. 7 = Sunday
  day_of_week        smallint not null,
  day_name           text not null,
  -- Israeli working week: the weekend is Friday and Saturday. This is a market
  -- decision, not a calendar fact — change it here if that stops being true.
  is_weekend         boolean not null,
  iso_week           smallint not null,
  iso_year           smallint not null,
  week_start_date    date not null,
  month_start_date   date not null,
  quarter_start_date date not null,
  year_start_date    date not null
);

insert into analytics.dim_date (
  date_key, full_date, year, quarter, month, month_name,
  day_of_month, day_of_week, day_name, is_weekend,
  iso_week, iso_year, week_start_date, month_start_date,
  quarter_start_date, year_start_date)
select
  to_char(d, 'YYYYMMDD')::int,
  d::date,
  extract(year    from d)::smallint,
  extract(quarter from d)::smallint,
  extract(month   from d)::smallint,
  to_char(d, 'Month')::text,
  extract(day     from d)::smallint,
  extract(isodow  from d)::smallint,
  to_char(d, 'Day')::text,
  extract(isodow from d) in (5, 6),
  extract(week    from d)::smallint,
  extract(isoyear from d)::smallint,
  date_trunc('week',    d)::date,
  date_trunc('month',   d)::date,
  date_trunc('quarter', d)::date,
  date_trunc('year',    d)::date
from generate_series(
       '2024-01-01'::timestamp,
       '2032-12-31'::timestamp,
       interval '1 day') d
on conflict (date_key) do nothing;

-- The unknown member. Every dimension in this warehouse carries one so that no
-- fact ever holds a NULL foreign key: a NULL silently drops the row from every
-- inner join, which is how a warehouse loses 8% of its traffic without anyone
-- noticing. An explicit Unknown row stays countable.
insert into analytics.dim_date (
  date_key, full_date, year, quarter, month, month_name,
  day_of_month, day_of_week, day_name, is_weekend,
  iso_week, iso_year, week_start_date, month_start_date,
  quarter_start_date, year_start_date)
values (
  -1, '0001-01-01', 0, 0, 0, '(unknown)', 0, 0, '(unknown)', false,
  0, 0, '0001-01-01', '0001-01-01', '0001-01-01', '0001-01-01')
on conflict (date_key) do nothing;

-- Convenience: timestamp -> date_key, with the unknown member for NULL.
create or replace function analytics.date_key(p_ts timestamptz)
returns integer language sql immutable parallel safe as
$fn$
  select case when p_ts is null then -1
              else to_char((p_ts at time zone 'utc')::date, 'YYYYMMDD')::int end
$fn$;

-- ============================================================
-- Company normalization
-- ============================================================
--
-- jobs.company is free text written by four independent producers: the fast
-- LLM at paste time, the user typing it (the funnel refuses to continue without
-- a company name), a regex fallback in src/lib/text.ts, and a backfill at
-- generation time. "Google", "google inc" and "Google Inc." will all occur.
-- Without a canonical key, "how many companies are recruiting" counts spellings.
--
-- Every step below is a decision. Order matters: two of them must happen before
-- punctuation is destroyed.
create or replace function analytics.norm_company(p_raw text)
returns text
language plpgsql
immutable
parallel safe
as $fn$
declare
  s    text;
  toks text[];
  n    int;
begin
  s := coalesce(p_raw, '');
  if btrim(s) = '' then return null; end if;

  -- 1. Strip bidi and zero-width controls. Hebrew-language job descriptions are
  --    full of these and they make "Wix" and "Wix" two different strings.
  --    translate() rather than a regex, so there is no escaping ambiguity.
  s := translate(s, concat(
         chr(8203), chr(8204), chr(8205), chr(8206), chr(8207),
         chr(8234), chr(8235), chr(8236), chr(8237), chr(8238), chr(65279)), '');

  -- 2. Domain suffix, BEFORE punctuation is collapsed: "monday.com" -> "monday",
  --    "wix.com" -> "wix". Skipping this leaves "monday" and "monday com" as two
  --    companies, which is the single most common real-world miss.
  s := regexp_replace(s,
        '\.(com|co|io|ai|net|org|dev|app|xyz|me|us|il|uk|de|fr|nl|se|tv)([^[:alnum:]]|$)',
        '\2', 'gi');

  -- 3. Hebrew legal forms, also before punctuation: the gershayim IS punctuation,
  --    so בע"מ / בע״מ / בעמ have to be caught while they still look like themselves.
  s := regexp_replace(s, 'בע[[:space:]"''׳״]*מ', ' ', 'g');
  s := regexp_replace(s, '\(?ע[''׳״"]?ר\)?', ' ', 'g');

  -- 4. Case-fold and collapse every non-alphanumeric run to one space.
  --    '&' is DROPPED rather than expanded: "H&M" -> "hm", "AT&T" -> "att".
  --    Expanding to " and " would split H&M into two tokens. Either choice is
  --    wrong for some input; this one is at least consistent.
  s := btrim(regexp_replace(lower(s), '[^[:alnum:]]+', ' ', 'g'));
  if s = '' then return null; end if;

  s := regexp_replace(s, '^the +', '');

  -- 5. Strip trailing legal-form tokens, iteratively — "Foo Systems Inc Ltd" is
  --    a real string, and one pass would leave "foo systems inc".
  toks := string_to_array(s, ' ');
  loop
    n := cardinality(toks);
    exit when n <= 1;
    exit when toks[n] not in (
      'ltd','limited','inc','incorporated','llc','llp','lp','plc','corp',
      'corporation','co','company','gmbh','mbh','ag','kg','ohg','ug','se',
      'sa','sas','sarl','sl','nv','bv','oy','oyj','ab','as','asa','aps',
      'pty','pte','sdn','bhd','srl','spa','kk','kft','zrt','doo','ood',
      'sro','ltda','vof');
    toks := toks[1:n-1];
  end loop;
  s := array_to_string(toks, ' ');
  if s = '' then return null; end if;

  -- 6. Strings that look like a company and never are. The regex fallback in
  --    src/lib/text.ts guards its own output with NOT_A_COMPANY; this guards
  --    every producer, including the user typing "confidential" to get past the
  --    required field.
  if s in ('n a','na','unknown','none','confidential','anonymous','undisclosed',
           'company','our client','client','recruitment','agency','recruiter',
           'staffing','stealth','stealth mode','startup','tbd','test','xxx') then
    return null;
  end if;

  return s;
end $fn$;

-- The same, plus a pass over SOFT suffixes. Deliberately NOT the key.
--
-- "Wix" and "Wix Technologies" should probably merge; "Alphabet" and
-- "Alphabet Labs" probably should not. Aggressive stripping inside the key
-- produces silent, unfixable false merges, so this value is stored only to
-- FEED A SUGGESTION QUERY that a human approves. The difference between
-- "merged automatically" and "offered for merging" is the difference between a
-- dimension you can trust and one you cannot.
create or replace function analytics.norm_company_loose(p_raw text)
returns text
language plpgsql
immutable
parallel safe
as $fn$
declare
  s    text := analytics.norm_company(p_raw);
  toks text[];
  n    int;
begin
  if s is null then return null; end if;
  toks := string_to_array(s, ' ');
  loop
    n := cardinality(toks);
    exit when n <= 1;
    exit when toks[n] not in (
      'technologies','technology','tech','labs','lab','software','solutions',
      'systems','group','holdings','ventures','studio','studios','partners',
      'media','digital','global','international','services','consulting',
      'industries','enterprises','networks','interactive','online');
    toks := toks[1:n-1];
  end loop;
  return nullif(array_to_string(toks, ' '), '');
end $fn$;

-- ============================================================
-- Role normalization
-- ============================================================

-- Everything a posting bolts onto a title that is not the title: gender markers,
-- requisition numbers, the location after a dash, employment-type noise.
create or replace function analytics.role_clean(p_raw text)
returns text language sql immutable parallel safe as
$fn$
  select btrim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(lower(coalesce(p_raw, '')),
          '\(([mfdwxhn][/\\ ]*)+\)', ' ', 'g'),
        '[#\(\[]?[[:space:]]*(job[[:space:]]*)?(req|requisition|id|ref)[[:space:]]*[:#]?[[:space:]]*[a-z0-9\-]{3,}[[:space:]]*[\)\]]?', ' ', 'gi'),
      '[[:space:]]+[-–—|/@][[:space:]]+.*$', ' ', 'g'),
    '\m(full[ -]?time|part[ -]?time|contract|temporary|permanent|remote|hybrid|on[ -]?site|w2|c2c|urgent|hiring|position|role|opening|vacancy)\M', ' ', 'gi'))
$fn$;

create or replace function analytics.norm_role(p_raw text)
returns text language sql immutable parallel safe as
$fn$
  select nullif(btrim(regexp_replace(
           regexp_replace(analytics.role_clean(p_raw), '[^[:alnum:]]+', ' ', 'g'),
           '[[:space:]]+', ' ', 'g')), '')
$fn$;

-- Seniority, checked from the TOP DOWN so the highest marker present wins:
-- "Senior Director" is a director, not a senior.
--
-- Two calls worth arguing about, both deliberate:
--
--   'mid' is never inferred. A title with no seniority word is usually mid, but
--   defaulting to it invents data and makes the mid bucket the largest by
--   construction. 'unspecified' is the honest answer; fold it into mid at read
--   time if you want to.
--
--   'manager' maps to 'lead', not 'director'. "Product Manager" and
--   "Engineering Manager" are wildly different levels, and PM is far more common
--   in this product's traffic — mapping manager high would systematically
--   inflate the seniority mix.
create or replace function analytics.role_seniority(p_raw text)
returns text language plpgsql immutable parallel safe as
$fn$
declare s text := ' ' || coalesce(analytics.norm_role(p_raw), '') || ' ';
begin
  if s ~ '\m(ceo|cto|cfo|coo|cpo|cmo|cro|ciso|cio|cdo|cso|chief|founder|cofounder|president|owner)\M' then return 'c_level';   end if;
  if s ~ '\m(vp|svp|evp|avp|vice president)\M'                                    then return 'vp';        end if;
  if s ~ '\m(director|directors|dir)\M'                                           then return 'director';  end if;
  if s ~ '\m(head)\M'                                                             then return 'head';      end if;
  if s ~ '\m(principal|distinguished|fellow)\M'                                   then return 'principal'; end if;
  if s ~ '\m(staff)\M'                                                            then return 'staff';     end if;
  if s ~ '\m(lead|leader|tl|manager|mgr)\M'                                       then return 'lead';      end if;
  if s ~ '\m(senior|sr|snr|iii|iv|expert|advanced)\M'                             then return 'senior';    end if;
  if s ~ '\m(junior|jr|jnr|entry|associate|graduate|grad|trainee)\M'               then return 'junior';    end if;
  if s ~ '\m(intern|internship|student|apprentice)\M'                             then return 'intern';    end if;
  if s ~ '\m(mid|intermediate|ii)\M'                                              then return 'mid';       end if;
  return 'unspecified';
end $fn$;

create or replace function analytics.role_seniority_rank(p_seniority text)
returns smallint language sql immutable parallel safe as
$fn$
  select (case p_seniority
    when 'intern'    then 1  when 'junior'  then 2  when 'mid'      then 3
    when 'senior'    then 4  when 'lead'    then 5  when 'staff'    then 6
    when 'principal' then 7  when 'head'    then 8  when 'director' then 9
    when 'vp'        then 10 when 'c_level' then 11 else 0 end)::smallint
$fn$;

-- The title with seniority words removed, so "Senior Data Analyst" and
-- "Junior Data Analyst" can be recognised as the same job at two levels.
create or replace function analytics.role_core(p_raw text)
returns text language sql immutable parallel safe as
$fn$
  select nullif(btrim(regexp_replace(
    regexp_replace(coalesce(analytics.norm_role(p_raw), ''),
      '\m(senior|sr|snr|junior|jr|jnr|lead|leader|principal|staff|head|director|vp|svp|evp|avp|chief|intern|internship|entry|associate|graduate|trainee|mid|intermediate|i|ii|iii|iv|of)\M',
      ' ', 'g'),
    '[[:space:]]+', ' ', 'g')), '')
$fn$;

-- ============================================================
-- Role families: data, not code
-- ============================================================
--
-- Same discipline as TOPIC_KEYWORDS in src/lib/topics.ts — specific patterns
-- above generic ones, first hit wins. Kept in a table so that adding a family
-- is an INSERT rather than a migration, and so a wrong classification can be
-- fixed by the person who noticed it.
create table if not exists analytics.role_family_rule (
  rule_id   integer generated always as identity primary key,
  pattern   text not null,
  family    text not null,
  priority  smallint not null default 100,
  is_active boolean not null default true
);

create index if not exists role_family_rule_active_idx
  on analytics.role_family_rule (priority) where is_active;

insert into analytics.role_family_rule (pattern, family, priority) values
  ('\m(data (analyst|scientist|engineer)|analytics engineer|bi |business intelligence|machine learning|ml |mlops|deep learning|nlp)\M', 'data',        10),
  ('\m(devops|sre|site reliability|platform engineer|infrastructure engineer|cloud engineer)\M',                                       'infrastructure', 15),
  ('\m(security|infosec|appsec|penetration tester|pentester|soc )\M',                                                                  'security',    20),
  ('\m(qa|quality assurance|test engineer|automation engineer|sdet)\M',                                                                'qa',          25),
  ('\m(product manager|product owner|product lead|technical product)\M',                                                               'product',     30),
  -- Deliberately after the specific product titles and before engineering:
  -- catches "VP Product", "Head of Product", "Director of Product", which would
  -- otherwise fall all the way through to 'other'.
  ('\m(product)\M',                                                                                                                    'product',     32),
  ('\m(designer|ux|ui|user experience|user research|creative)\M',                                                                      'design',      35),
  ('\m(software|developer|engineer|programmer|full stack|fullstack|frontend|front end|backend|back end|mobile|android|ios|architect)\M','engineering', 40),
  ('\m(marketing|growth|seo|sem|content|brand|communications|social media|copywriter)\M',                                              'marketing',   45),
  ('\m(sales|account executive|business development|bdr|sdr|partnerships|customer success)\M',                                         'sales',       50),
  ('\m(finance|accountant|accounting|controller|fp&a|bookkeeper|treasury|audit)\M',                                                    'finance',     55),
  ('\m(hr|human resources|recruit|talent|people operations|people partner)\M',                                                         'people',      60),
  ('\m(operations|logistics|supply chain|procurement|project manager|program manager|scrum master)\M',                                 'operations',  65),
  ('\m(support|help desk|helpdesk|service desk|technical support|customer service)\M',                                                 'support',     70),
  ('\m(legal|lawyer|attorney|counsel|compliance|paralegal)\M',                                                                         'legal',       75),
  ('\m(research|scientist|phd|postdoc|clinical)\M',                                                                                    'research',    80),
  ('\m(teacher|instructor|lecturer|tutor|education)\M',                                                                                'education',   85),
  ('\m(nurse|doctor|physician|medical|healthcare|therapist|pharmac)\M',                                                                'healthcare',  90)
on conflict do nothing;

-- STABLE, not IMMUTABLE: it reads a table whose contents are meant to change.
-- That rules it out of an index or a generated column, which is fine — it is
-- only ever called by the ETL.
create or replace function analytics.role_family(p_raw text)
returns text language plpgsql stable as
$fn$
declare
  s text := ' ' || coalesce(analytics.norm_role(p_raw), '') || ' ';
  r record;
begin
  if btrim(s) = '' then return 'unknown'; end if;
  for r in
    select pattern, family from analytics.role_family_rule
     where is_active order by priority asc, rule_id asc
  loop
    if s ~* r.pattern then return r.family; end if;
  end loop;
  return 'other';
end $fn$;

-- ============================================================
-- Acquisition helpers
-- ============================================================
--
-- Where a visitor came from, bucketed. The 'ai' bucket is separated from
-- 'search' on purpose: for a CV product in 2026, arriving from ChatGPT is a
-- different acquisition story from arriving from Google, and merging them
-- hides the one number worth watching.
create or replace function analytics.referrer_type(p_host text)
returns text language sql immutable parallel safe as
$fn$
  select case
    when coalesce(p_host, '') = ''                                    then 'direct'
    when p_host ~* '(chatgpt|openai|claude\.ai|anthropic|perplexity|gemini\.google|copilot\.microsoft)' then 'ai'
    when p_host ~* '(google|bing|duckduckgo|yahoo|yandex|baidu|ecosia|brave)'                          then 'search'
    when p_host ~* '(facebook|instagram|linkedin|twitter|x\.com|t\.co|tiktok|reddit|youtube|whatsapp|telegram|pinterest)' then 'social'
    else 'referral' end
$fn$;

-- Domain only. The address itself never enters the warehouse.
create or replace function analytics.email_domain(p_email text)
returns text language sql immutable parallel safe as
$fn$
  select nullif(lower(split_part(coalesce(p_email, ''), '@', 2)), '')
$fn$;

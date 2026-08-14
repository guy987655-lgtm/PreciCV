-- 0019 — the ETL.
--
-- One driver, analytics.refresh_all(), and one function per step. Every step is
-- independently runnable, which turns "the warehouse is wrong" from a bisect
-- into a one-line reproduction.
--
-- Three properties hold across every step:
--
--   IDEMPOTENT   Every write is INSERT ... ON CONFLICT (natural key) DO UPDATE.
--                Running refresh_all() five times in a row produces identical
--                output. The single exception is assign_question creating a new
--                cluster leader, and that is guarded by the advisory lock.
--
--   INCREMENTAL  Steps read only rows newer than their watermark. That is what
--                migration 0012's updated_at columns bought: without them, a
--                CV edited six months from now would never be re-read.
--
--   LATE-TOLERANT Watermarks advance to max(updated_at) MINUS five minutes. A
--                transaction that began before the ETL read but commits after it
--                would otherwise be skipped forever. Re-processing a few minutes
--                of rows costs nothing because every write is an upsert.

-- ============================================================
-- Watermark helpers
-- ============================================================

create or replace function analytics.wm_get(p_step text, p_full boolean default false)
returns timestamptz language sql stable as
$fn$
  select case
    when p_full then '-infinity'::timestamptz
    else coalesce((select last_value from analytics.etl_watermark
                    where step_name = p_step), '-infinity'::timestamptz)
  end
$fn$;

create or replace function analytics.wm_set(p_step text, p_value timestamptz)
returns void language plpgsql as
$fn$
begin
  if p_value is null then return; end if;
  insert into analytics.etl_watermark (step_name, last_value)
  values (p_step, p_value - interval '5 minutes')
  on conflict (step_name) do update
    set last_value = greatest(analytics.etl_watermark.last_value,
                              excluded.last_value);
end $fn$;

-- ============================================================
-- CV shape helpers
-- ============================================================
--
-- The cv jsonb is generic sections, not typed experience/education, so these
-- walk it rather than reading named fields. cv_char_estimate mirrors
-- estimateCvChars() in src/lib/llm.ts, which is what the one-page budget of
-- 3600 characters is measured against.

create or replace function analytics.cv_section_count(p_cv jsonb)
returns integer language sql immutable parallel safe as
$fn$ select jsonb_array_length(coalesce(p_cv->'sections', '[]'::jsonb)) $fn$;

create or replace function analytics.cv_item_count(p_cv jsonb)
returns integer language sql immutable parallel safe as
$fn$
  select coalesce((
    select sum(jsonb_array_length(coalesce(s->'items', '[]'::jsonb)))::int
      from jsonb_array_elements(coalesce(p_cv->'sections', '[]'::jsonb)) s), 0)
$fn$;

create or replace function analytics.cv_bullet_count(p_cv jsonb)
returns integer language sql immutable parallel safe as
$fn$
  select coalesce((
    select sum(jsonb_array_length(coalesce(i->'bullets', '[]'::jsonb)))::int
      from jsonb_array_elements(coalesce(p_cv->'sections', '[]'::jsonb)) s,
           jsonb_array_elements(coalesce(s->'items', '[]'::jsonb)) i), 0)
$fn$;

create or replace function analytics.cv_char_estimate(p_cv jsonb)
returns integer language sql immutable parallel safe as
$fn$
  select coalesce(length(p_cv->>'headline'), 0)
       + coalesce(length(p_cv->>'summary'), 0)
       + coalesce((select sum(length(x))::int
                     from jsonb_array_elements_text(coalesce(p_cv->'skills', '[]'::jsonb)) x), 0)
       + coalesce((select sum(coalesce(length(i->>'primary'), 0)
                            + coalesce(length(i->>'secondary'), 0)
                            + coalesce(length(i->>'meta'), 0))::int
                     from jsonb_array_elements(coalesce(p_cv->'sections', '[]'::jsonb)) s,
                          jsonb_array_elements(coalesce(s->'items', '[]'::jsonb)) i), 0)
       + coalesce((select sum(length(b))::int
                     from jsonb_array_elements(coalesce(p_cv->'sections', '[]'::jsonb)) s,
                          jsonb_array_elements(coalesce(s->'items', '[]'::jsonb)) i,
                          jsonb_array_elements_text(coalesce(i->'bullets', '[]'::jsonb)) b), 0)
$fn$;

-- ============================================================
-- Conformed dimensions built from free text
-- ============================================================
--
-- All three follow the same shape: find raw strings not already routed, create
-- the canonical row if needed, then record the alias. Keys are never rebuilt
-- and rows with source='human' are never touched — that is what makes a manual
-- merge survive every future refresh.

create or replace function analytics.refresh_dim_company(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_n bigint := 0;
begin
  with raw as (
    select distinct btrim(company) as raw_text
      from public.jobs where btrim(coalesce(company, '')) <> ''
    union
    select distinct btrim(company_raw)
      from public.funnel_events where btrim(coalesce(company_raw, '')) <> ''
  ),
  fresh as (
    select r.raw_text,
           md5(r.raw_text) as raw_hash,
           analytics.norm_company(r.raw_text) as norm
      from raw r
     where not exists (select 1 from analytics.dim_company_alias a
                        where a.raw_hash = md5(r.raw_text))
  ),
  upserted as (
    insert into analytics.dim_company (
      company_norm, company_display, company_norm_loose, first_seen_at)
    select distinct on (f.norm)
           f.norm, f.raw_text, analytics.norm_company_loose(f.raw_text), now()
      from fresh f
     where f.norm is not null
     order by f.norm, f.raw_text
    on conflict (company_norm) do update set etl_updated_at = now()
    returning company_key, company_norm
  )
  insert into analytics.dim_company_alias (raw_hash, raw_text, company_key, source)
  select f.raw_hash, f.raw_text,
         -- `existing` cannot see rows inserted by `upserted` (same snapshot),
         -- which is exactly why both are consulted.
         coalesce(u.company_key, existing.company_key, -1),
         'auto'
    from fresh f
    left join upserted u             on u.company_norm = f.norm
    left join analytics.dim_company existing on existing.company_norm = f.norm
  on conflict (raw_hash) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function analytics.refresh_dim_role(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_n bigint := 0;
begin
  with raw as (
    select distinct btrim(title) as raw_text
      from public.jobs where btrim(coalesce(title, '')) <> ''
    union
    select distinct btrim(role_raw)
      from public.funnel_events where btrim(coalesce(role_raw, '')) <> ''
  ),
  fresh as (
    select r.raw_text, md5(r.raw_text) as raw_hash,
           analytics.norm_role(r.raw_text) as norm
      from raw r
     where not exists (select 1 from analytics.dim_role_alias a
                        where a.raw_hash = md5(r.raw_text))
  ),
  upserted as (
    insert into analytics.dim_role (
      role_norm, role_display, role_core_norm, seniority, seniority_rank,
      role_family, first_seen_at)
    select distinct on (f.norm)
           f.norm,
           f.raw_text,
           analytics.role_core(f.raw_text),
           analytics.role_seniority(f.raw_text),
           analytics.role_seniority_rank(analytics.role_seniority(f.raw_text)),
           analytics.role_family(f.raw_text),
           now()
      from fresh f
     where f.norm is not null
     order by f.norm, f.raw_text
    on conflict (role_norm) do update set etl_updated_at = now()
    returning role_key, role_norm
  )
  insert into analytics.dim_role_alias (raw_hash, raw_text, role_key, source)
  select f.raw_hash, f.raw_text,
         coalesce(u.role_key, existing.role_key, -1), 'auto'
    from fresh f
    left join upserted u                  on u.role_norm = f.norm
    left join analytics.dim_role existing on existing.role_norm = f.norm
  on conflict (raw_hash) do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function analytics.refresh_dim_field(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_n bigint := 0;
begin
  insert into analytics.dim_field (field_norm, field_display, first_seen_at)
  select distinct on (lower(btrim(field_raw)))
         lower(btrim(field_raw)), btrim(field_raw), now()
    from public.funnel_events
   where btrim(coalesce(field_raw, '')) <> ''
   order by lower(btrim(field_raw)), btrim(field_raw)
  on conflict (field_norm) do update set etl_updated_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- Feeds only genuinely new question texts into the clusterer, in the same
-- deterministic order a full rebuild would use.
create or replace function analytics.refresh_dim_question(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare r record; v_n bigint := 0;
begin
  for r in
    select q.text
      from (
        select btrim(question) as text, min(created_at) as seen
          from public.profile_answers
         where btrim(coalesce(question, '')) <> ''
         group by 1
        union all
        select btrim(t) as text, min(fe.occurred_at) as seen
          from public.funnel_events fe,
               lateral unnest(coalesce(fe.question_texts, '{}'::text[])) t
         where btrim(coalesce(t, '')) <> ''
         group by 1
      ) q
     where not exists (select 1 from analytics.question_variant v
                        where v.variant_hash = md5(q.text))
     group by q.text
     order by min(q.seen) asc, md5(q.text) asc
  loop
    perform analytics.assign_question(r.text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $fn$;

-- ============================================================
-- Junk dimensions — they only ever grow
-- ============================================================

create or replace function analytics.refresh_dim_acquisition(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_n bigint := 0;
begin
  insert into analytics.dim_acquisition (
    acq_hash, referrer_host, referrer_type, utm_source, utm_medium,
    utm_campaign, utm_term, utm_content, landing_path, landing_section,
    is_direct, is_paid_hint)
  select distinct on (s.acq_hash)
    s.acq_hash, s.referrer_host, analytics.referrer_type(s.referrer_host),
    s.utm_source, s.utm_medium, s.utm_campaign, s.utm_term, s.utm_content,
    s.entry_path, split_part(btrim(coalesce(s.entry_path, ''), '/'), '/', 1),
    coalesce(s.referrer_host, '') = '' and coalesce(s.utm_source, '') = '',
    coalesce(s.utm_medium, '') ~* '(cpc|ppc|paid|display|retarget)'
  from (
    select v.referrer_host, v.utm_source, v.utm_medium, v.utm_campaign,
           v.utm_term, v.utm_content, v.entry_path,
           md5(concat_ws('|', coalesce(v.referrer_host, ''),
                              coalesce(v.utm_source, ''), coalesce(v.utm_medium, ''),
                              coalesce(v.utm_campaign, ''), coalesce(v.utm_term, ''),
                              coalesce(v.utm_content, ''), coalesce(v.entry_path, ''))) as acq_hash
      from public.visits v
  ) s
  where not exists (select 1 from analytics.dim_acquisition d where d.acq_hash = s.acq_hash)
  order by s.acq_hash
  on conflict (acq_hash) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function analytics.refresh_dim_device(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_n bigint := 0;
begin
  insert into analytics.dim_device (
    device_hash, device_type, os_family, browser_family, lang_primary,
    country, is_bot_suspect)
  select distinct on (s.device_hash)
    s.device_hash, s.device_type, s.os_family, s.browser_family,
    s.lang, s.country, s.bot_suspect
  from (
    select coalesce(v.device_type, 'unknown')    as device_type,
           coalesce(v.os_family, 'unknown')      as os_family,
           coalesce(v.browser_family, 'unknown') as browser_family,
           v.lang, v.country, v.bot_suspect,
           md5(concat_ws('|', coalesce(v.device_type, 'unknown'),
                              coalesce(v.os_family, 'unknown'),
                              coalesce(v.browser_family, 'unknown'),
                              coalesce(v.lang, ''), coalesce(v.country, ''),
                              v.bot_suspect::text)) as device_hash
      from public.visits v
  ) s
  where not exists (select 1 from analytics.dim_device d where d.device_hash = s.device_hash)
  order by s.device_hash
  on conflict (device_hash) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- ============================================================
-- Entity dimensions
-- ============================================================

create or replace function analytics.refresh_dim_visitor(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('dim_visitor', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(updated_at) into v_max from public.visitors;

  insert into analytics.dim_visitor (
    visitor_id, first_seen_at, first_seen_date_key, last_seen_at,
    last_seen_date_key, acquisition_key, device_key, first_country,
    visit_count, event_count, cookie_signed, bot_suspect, etl_updated_at)
  select
    v.visitor_id, v.first_seen_at, analytics.date_key(v.first_seen_at),
    v.last_seen_at, analytics.date_key(v.last_seen_at),
    coalesce(a.acquisition_key, -1), coalesce(d.device_key, -1),
    v.first_country, v.visit_count, v.event_count,
    v.cookie_signed, v.bot_suspect, now()
  from public.visitors v
  -- First touch, resolved through the visitor's OWN first visit rather than
  -- the visitors row: the junk-dimension keys live on visits.
  left join lateral (
    select vs.* from public.visits vs
     where vs.visitor_id = v.visitor_id
     order by vs.started_at asc limit 1) fv on true
  left join analytics.dim_acquisition a on a.acq_hash = md5(concat_ws('|',
        coalesce(fv.referrer_host, ''), coalesce(fv.utm_source, ''),
        coalesce(fv.utm_medium, ''), coalesce(fv.utm_campaign, ''),
        coalesce(fv.utm_term, ''), coalesce(fv.utm_content, ''),
        coalesce(fv.entry_path, '')))
  left join analytics.dim_device d on d.device_hash = md5(concat_ws('|',
        coalesce(fv.device_type, 'unknown'), coalesce(fv.os_family, 'unknown'),
        coalesce(fv.browser_family, 'unknown'), coalesce(fv.lang, ''),
        coalesce(fv.country, ''), coalesce(fv.bot_suspect, false)::text))
  where v.updated_at > v_wm
  on conflict (visitor_id) do update set
    last_seen_at       = excluded.last_seen_at,
    last_seen_date_key = excluded.last_seen_date_key,
    visit_count        = excluded.visit_count,
    event_count        = excluded.event_count,
    bot_suspect        = excluded.bot_suspect,
    -- Type 0: first touch is written once and never revised.
    acquisition_key    = case when analytics.dim_visitor.acquisition_key = -1
                              then excluded.acquisition_key
                              else analytics.dim_visitor.acquisition_key end,
    device_key         = case when analytics.dim_visitor.device_key = -1
                              then excluded.device_key
                              else analytics.dim_visitor.device_key end,
    etl_updated_at     = now();

  get diagnostics v_n = row_count;
  perform analytics.wm_set('dim_visitor', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_dim_user(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('dim_user', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select greatest(max(p.updated_at), max(u.updated_at))
    into v_max
    from public.profiles p full join auth.users u on u.id = p.user_id;

  insert into analytics.dim_user (
    user_id, signup_visitor_key, signup_visitor_id, auth_provider_key,
    signup_at, signup_date_key, email_domain, is_onboarded, free_sample_used,
    default_template_key, cv_theme, split_view, hide_ai_section,
    has_cv_on_file, cv_uploaded_at, cv_char_count, dealbreaker_count,
    additional_fact_count, etl_updated_at)
  select
    au.id,
    coalesce(dv.visitor_key, -1),
    vu.visitor_id,
    coalesce(ap.auth_provider_key, -1),
    au.created_at,
    analytics.date_key(au.created_at),
    analytics.email_domain(coalesce(p.email, au.email)),
    coalesce(p.onboarded, false),
    coalesce(p.free_sample_used, false),
    coalesce(dt.template_key, -1),
    p.cv_theme, p.split_view, p.hide_ai_section,
    coalesce(length(btrim(coalesce(p.raw_cv_text, ''))) > 0, false),
    p.cv_uploaded_at,
    length(coalesce(p.raw_cv_text, '')),
    jsonb_array_length(coalesce(p.dealbreakers, '[]'::jsonb))::smallint,
    coalesce(jsonb_array_length(p.master_data->'additionalFacts'), 0)::smallint,
    now()
  from auth.users au
  left join public.profiles p on p.user_id = au.id
  left join public.visitor_users vu on vu.user_id = au.id and vu.is_signup_visitor
  left join analytics.dim_visitor dv on dv.visitor_id = vu.visitor_id
  left join lateral (
    select i.provider from auth.identities i
     where i.user_id = au.id order by i.created_at asc limit 1) idp on true
  left join analytics.dim_auth_provider ap on ap.provider = idp.provider
  left join analytics.dim_template dt on dt.template_code = p.default_template
  where greatest(au.updated_at, coalesce(p.updated_at, au.updated_at)) > v_wm
  on conflict (user_id) do update set
    -- WRITE ONCE. coalesce(existing, new) means the pairing recorded at
    -- registration can never be overwritten by a later refresh, and a second
    -- device linking to the same account cannot displace it.
    signup_visitor_key = case when analytics.dim_user.signup_visitor_key = -1
                              then excluded.signup_visitor_key
                              else analytics.dim_user.signup_visitor_key end,
    signup_visitor_id  = coalesce(analytics.dim_user.signup_visitor_id,
                                  excluded.signup_visitor_id),
    auth_provider_key    = excluded.auth_provider_key,
    email_domain         = excluded.email_domain,
    is_onboarded         = excluded.is_onboarded,
    free_sample_used     = excluded.free_sample_used,
    default_template_key = excluded.default_template_key,
    cv_theme             = excluded.cv_theme,
    split_view           = excluded.split_view,
    hide_ai_section      = excluded.hide_ai_section,
    has_cv_on_file       = excluded.has_cv_on_file,
    cv_uploaded_at       = excluded.cv_uploaded_at,
    cv_char_count        = excluded.cv_char_count,
    dealbreaker_count    = excluded.dealbreaker_count,
    additional_fact_count = excluded.additional_fact_count,
    etl_updated_at       = now();

  get diagnostics v_n = row_count;

  -- The reverse side of the permanent pairing.
  update analytics.dim_visitor dv
     set signup_user_key = du.user_key,
         is_identified   = true,
         first_signup_at = least(coalesce(dv.first_signup_at, du.signup_at), du.signup_at)
    from analytics.dim_user du
   where du.signup_visitor_key = dv.visitor_key
     and dv.visitor_key <> -1
     and dv.signup_user_key is distinct from du.user_key;

  update analytics.dim_visitor dv
     set linked_user_count = c.n
    from (select vu.visitor_id, count(*)::smallint as n
            from public.visitor_users vu group by 1) c
   where c.visitor_id = dv.visitor_id
     and dv.linked_user_count is distinct from c.n;

  perform analytics.wm_set('dim_user', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_dim_run(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('dim_run', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(updated_at) into v_max from public.jobs;

  insert into analytics.dim_run (
    batch_id, user_key, job_count, created_at, created_date_key,
    is_multi_job, source, etl_updated_at)
  select
    j.batch_id, coalesce(du.user_key, -1), count(*)::smallint,
    min(j.created_at), analytics.date_key(min(j.created_at)),
    count(*) > 1,
    -- Every real row today comes through the funnel import; the account-side
    -- POST /api/jobs has no caller. 'account_other' exists so that stops being
    -- an assumption the moment it changes.
    case when bool_or(j.origin_visitor_id is not null) then 'funnel_import'
         else 'account_other' end,
    now()
  from public.jobs j
  left join analytics.dim_user du on du.user_id = j.user_id
  where j.batch_id is not null and j.updated_at > v_wm
  group by j.batch_id, du.user_key
  on conflict (batch_id) do update set
    job_count      = excluded.job_count,
    is_multi_job   = excluded.is_multi_job,
    source         = excluded.source,
    etl_updated_at = now();

  get diagnostics v_n = row_count;
  perform analytics.wm_set('dim_run', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_dim_job(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('dim_job', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(updated_at) into v_max from public.jobs;

  insert into analytics.dim_job (
    job_id, user_key, run_key, company_key, role_key, jd_hash,
    jd_char_count, jd_word_count, status, is_deleted, deleted_at,
    has_display_name, dealbreaker_hit_count, origin_visitor_key,
    created_at, created_date_key, etl_updated_at)
  select
    j.id,
    coalesce(du.user_key, -1),
    coalesce(dr.run_key, -1),
    coalesce(ca.company_key, -1),
    coalesce(ra.role_key, -1),
    j.jd_hash,
    length(coalesce(j.jd_text, '')),
    coalesce(array_length(regexp_split_to_array(btrim(coalesce(j.jd_text, '')), '[[:space:]]+'), 1), 0),
    j.status,
    j.deleted_at is not null,
    j.deleted_at,
    btrim(coalesce(j.display_name, '')) <> '',
    jsonb_array_length(coalesce(j.dealbreaker_hits, '[]'::jsonb))::smallint,
    coalesce(dv.visitor_key, -1),
    j.created_at,
    analytics.date_key(j.created_at),
    now()
  from public.jobs j
  left join analytics.dim_user du on du.user_id = j.user_id
  left join analytics.dim_run  dr on dr.batch_id = j.batch_id
  left join analytics.dim_company_alias ca on ca.raw_hash = md5(btrim(coalesce(j.company, '')))
  left join analytics.dim_role_alias    ra on ra.raw_hash = md5(btrim(coalesce(j.title, '')))
  left join analytics.dim_visitor dv on dv.visitor_id = j.origin_visitor_id
  where j.updated_at > v_wm
  on conflict (job_id) do update set
    company_key           = excluded.company_key,
    role_key              = excluded.role_key,
    run_key               = excluded.run_key,
    status                = excluded.status,
    is_deleted            = excluded.is_deleted,
    deleted_at            = excluded.deleted_at,
    has_display_name      = excluded.has_display_name,
    dealbreaker_hit_count = excluded.dealbreaker_hit_count,
    origin_visitor_key    = excluded.origin_visitor_key,
    etl_updated_at        = now();

  get diagnostics v_n = row_count;

  -- Generation rollups. Cheap enough to recompute for touched jobs only.
  update analytics.dim_job dj
     set generation_count    = g.n,
         max_revision_number = g.mx,
         first_generation_at = g.first_at
    from (select job_id, count(*)::smallint n,
                 max(revision_number)::smallint mx, min(created_at) first_at
            from public.generations group by 1) g
   where g.job_id = dj.job_id
     and (dj.generation_count is distinct from g.n
          or dj.max_revision_number is distinct from g.mx);

  update analytics.dim_job dj
     set is_purchased = true
    from public.purchases p
   where p.job_id = dj.job_id and p.status = 'paid' and not dj.is_purchased;

  perform analytics.wm_set('dim_job', v_max);
  return v_n;
end $fn$;

-- ============================================================
-- Facts
-- ============================================================

create or replace function analytics.refresh_fact_visit(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('fact_visit', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(updated_at) into v_max from public.visits;

  insert into analytics.fact_visit (
    visit_id, date_key, visitor_key, user_key, acquisition_key, device_key,
    occurred_at, visit_ended_at, hour_of_day_utc, entry_path,
    page_hit_count, event_count, duration_seconds, is_bounce,
    is_first_visit_for_visitor, converted_to_signup, bot_suspect,
    server_created, etl_updated_at)
  select
    v.visit_id,
    to_char(v.visit_date, 'YYYYMMDD')::int,
    coalesce(dv.visitor_key, -1),
    coalesce(du.user_key, -1),
    coalesce(a.acquisition_key, -1),
    coalesce(d.device_key, -1),
    v.started_at, v.last_seen_at,
    extract(hour from (v.started_at at time zone 'utc'))::smallint,
    v.entry_path,
    v.hit_count, v.event_count,
    greatest(0, extract(epoch from (v.last_seen_at - v.started_at))::int),
    v.hit_count <= 1 and v.event_count = 0,
    not exists (select 1 from public.visits e
                 where e.visitor_id = v.visitor_id and e.started_at < v.started_at),
    v.signup_in_visit,
    v.bot_suspect, v.server_created, now()
  from public.visits v
  left join analytics.dim_visitor dv on dv.visitor_id = v.visitor_id
  left join analytics.dim_user    du on du.user_id = v.user_id
  left join analytics.dim_acquisition a on a.acq_hash = md5(concat_ws('|',
        coalesce(v.referrer_host, ''), coalesce(v.utm_source, ''),
        coalesce(v.utm_medium, ''), coalesce(v.utm_campaign, ''),
        coalesce(v.utm_term, ''), coalesce(v.utm_content, ''),
        coalesce(v.entry_path, '')))
  left join analytics.dim_device d on d.device_hash = md5(concat_ws('|',
        coalesce(v.device_type, 'unknown'), coalesce(v.os_family, 'unknown'),
        coalesce(v.browser_family, 'unknown'), coalesce(v.lang, ''),
        coalesce(v.country, ''), v.bot_suspect::text))
  where v.updated_at > v_wm
  on conflict (visit_id) do update set
    user_key            = excluded.user_key,
    visit_ended_at      = excluded.visit_ended_at,
    page_hit_count      = excluded.page_hit_count,
    event_count         = excluded.event_count,
    duration_seconds    = excluded.duration_seconds,
    is_bounce           = excluded.is_bounce,
    converted_to_signup = excluded.converted_to_signup,
    etl_updated_at      = now();

  get diagnostics v_n = row_count;

  update analytics.fact_visit f
     set jd_submitted_count = c.n
    from (select fe.visit_id, count(*)::int n
            from public.funnel_events fe
           where fe.event_type = 'jd_submitted' and fe.visit_id is not null
           group by 1) c
   where c.visit_id = f.visit_id and f.jd_submitted_count is distinct from c.n;

  perform analytics.wm_set('fact_visit', v_max);
  return v_n;
end $fn$;

-- The conformed job-submission fact: anonymous pastes UNION account job rows.
create or replace function analytics.refresh_fact_jd_submission(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('fact_jd_submission', p_full);
        v_max timestamptz; v_n bigint := 0; v_t bigint := 0;
begin
  select greatest(
           (select max(occurred_at) from public.funnel_events),
           (select max(updated_at)  from public.jobs))
    into v_max;

  -- Side 1: the anonymous funnel.
  insert into analytics.fact_jd_submission (
    submission_id, date_key, visitor_key, user_key, company_key, role_key,
    field_key, job_key, occurred_at, source, jd_hash, jd_char_count,
    jd_word_count, is_anonymous, has_company, has_role, same_field,
    etl_updated_at)
  select
    'fe:' || fe.event_id,
    analytics.date_key(fe.occurred_at),
    coalesce(dv.visitor_key, -1),
    coalesce(du.user_key, -1),
    coalesce(ca.company_key, -1),
    coalesce(ra.role_key, -1),
    coalesce(df.field_key, -1),
    coalesce(dj.job_key, -1),
    fe.occurred_at,
    'try_jd_meta',
    fe.jd_hash,
    coalesce(fe.jd_chars, 0),
    coalesce(fe.jd_words, 0),
    fe.user_id is null,
    btrim(coalesce(fe.company_raw, '')) <> '',
    btrim(coalesce(fe.role_raw, '')) <> '',
    fe.same_field,
    now()
  from public.funnel_events fe
  left join analytics.dim_visitor dv on dv.visitor_id = fe.visitor_id
  left join analytics.dim_user    du on du.user_id = fe.user_id
  left join analytics.dim_company_alias ca on ca.raw_hash = md5(btrim(coalesce(fe.company_raw, '')))
  left join analytics.dim_role_alias    ra on ra.raw_hash = md5(btrim(coalesce(fe.role_raw, '')))
  left join analytics.dim_field df on df.field_norm = lower(btrim(coalesce(fe.field_raw, '')))
  -- The jd_hash join is what stitches an anonymous paste to the job it became.
  left join analytics.dim_job dj on dj.jd_hash = fe.jd_hash
  where fe.event_type = 'jd_submitted' and fe.occurred_at > v_wm
  on conflict (submission_id) do update set
    company_key    = excluded.company_key,
    role_key       = excluded.role_key,
    field_key      = excluded.field_key,
    job_key        = excluded.job_key,
    etl_updated_at = now();

  get diagnostics v_n = row_count;

  -- Side 2: jobs that exist on an account. Both sides count toward the row
  -- total this step reports, or the run log understates half its own work.
  insert into analytics.fact_jd_submission (
    submission_id, date_key, visitor_key, user_key, company_key, role_key,
    run_key, job_key, occurred_at, source, jd_hash, jd_char_count,
    jd_word_count, is_anonymous, became_account_job, has_company, has_role,
    etl_updated_at)
  select
    'job:' || j.id,
    analytics.date_key(j.created_at),
    coalesce(dv.visitor_key, -1),
    coalesce(du.user_key, -1),
    dj.company_key, dj.role_key, dj.run_key, dj.job_key,
    j.created_at,
    case when j.origin_visitor_id is not null then 'account_import'
         else 'account_other' end,
    j.jd_hash,
    dj.jd_char_count, dj.jd_word_count,
    false, true,
    btrim(coalesce(j.company, '')) <> '',
    btrim(coalesce(j.title, '')) <> '',
    now()
  from public.jobs j
  join analytics.dim_job dj on dj.job_id = j.id
  left join analytics.dim_user    du on du.user_id = j.user_id
  left join analytics.dim_visitor dv on dv.visitor_id = j.origin_visitor_id
  where j.updated_at > v_wm
  on conflict (submission_id) do update set
    company_key    = excluded.company_key,
    role_key       = excluded.role_key,
    run_key        = excluded.run_key,
    etl_updated_at = now();

  get diagnostics v_t = row_count;
  v_n := v_n + v_t;

  -- Close the loop on the anonymous side now that both exist.
  update analytics.fact_jd_submission f
     set became_account_job = true,
         job_key            = dj.job_key,
         seconds_to_account_job =
           greatest(0, extract(epoch from (dj.created_at - f.occurred_at))::int)
    from analytics.dim_job dj
   where dj.jd_hash = f.jd_hash
     and f.source = 'try_jd_meta'
     and not f.became_account_job;

  -- The house rule, materialised. Recomputed from scratch rather than
  -- incremented, so it cannot drift.
  --
  -- The dedupe exists for ONE situation: the same person pasting a job
  -- description anonymously and then importing it after signing up, which
  -- produces two true rows for one job. The only thing that links those rows is
  -- the visitor — so an UNKNOWN visitor is not evidence of anything, and rows
  -- carrying visitor_key = -1 must each stand alone.
  --
  -- Getting this wrong silently undercounts: every job created before visitor
  -- capture shipped has visitor_key = -1, so they all shared one partition, and
  -- two people applying to the same posting collapsed into a single "job
  -- uploaded". A NULL hash is treated the same way, for the same reason.
  update analytics.fact_jd_submission f
     set is_first_for_visitor_jd = r.is_first
    from (
      select submission_key,
             case
               when jd_hash is null or visitor_key = -1 then true
               else row_number() over (partition by visitor_key, jd_hash
                                       order by occurred_at, submission_id) = 1
             end as is_first
        from analytics.fact_jd_submission) r
   where r.submission_key = f.submission_key
     and f.is_first_for_visitor_jd is distinct from r.is_first;

  perform analytics.wm_set('fact_jd_submission', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_fact_generation(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('fact_generation', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(updated_at) into v_max from public.generations;

  insert into analytics.fact_generation (
    generation_id, date_key, user_key, job_key, company_key, role_key,
    run_key, template_key, occurred_at, source_updated_at, revision_number,
    is_sample, report_stale, cv_theme, split_view, match_score,
    match_score_is_missing, cv_char_estimate, over_one_page, change_count,
    changes_added, changes_removed, changes_modified, changes_reordered,
    strength_count, gap_count, recommendation_count, sim_question_count,
    sim_pitch_chars, section_count, item_count, bullet_count, skill_count,
    hidden_section_count, seconds_since_job_created, is_first_revision,
    etl_updated_at)
  select
    g.id,
    analytics.date_key(g.created_at),
    coalesce(du.user_key, -1),
    coalesce(dj.job_key, -1),
    coalesce(dj.company_key, -1),
    coalesce(dj.role_key, -1),
    coalesce(dj.run_key, -1),
    coalesce(dt.template_key, -1),
    g.created_at, g.updated_at, g.revision_number,
    g.is_sample, g.report_stale, g.cv_theme, g.split_view,
    -- See the column comment: a 0 with an empty gapAnalysis is the documented
    -- "model omitted it" path and becomes NULL, so avg() is not dragged down.
    case when m.missing then null
         else (g.diff->'gapAnalysis'->>'matchScore')::smallint end,
    m.missing,
    analytics.cv_char_estimate(g.cv),
    analytics.cv_char_estimate(g.cv) > 3600,
    jsonb_array_length(coalesce(g.diff->'changes', '[]'::jsonb)),
    (select count(*)::int from jsonb_array_elements(coalesce(g.diff->'changes','[]'::jsonb)) c where c->>'type' = 'added'),
    (select count(*)::int from jsonb_array_elements(coalesce(g.diff->'changes','[]'::jsonb)) c where c->>'type' = 'removed'),
    (select count(*)::int from jsonb_array_elements(coalesce(g.diff->'changes','[]'::jsonb)) c where c->>'type' = 'modified'),
    (select count(*)::int from jsonb_array_elements(coalesce(g.diff->'changes','[]'::jsonb)) c where c->>'type' = 'reordered'),
    jsonb_array_length(coalesce(g.diff->'gapAnalysis'->'strengths', '[]'::jsonb)),
    jsonb_array_length(coalesce(g.diff->'gapAnalysis'->'gaps', '[]'::jsonb)),
    jsonb_array_length(coalesce(g.diff->'gapAnalysis'->'recommendations', '[]'::jsonb)),
    jsonb_array_length(coalesce(g.simulation->'questions', '[]'::jsonb)),
    coalesce(length(g.simulation->>'pitch'), 0),
    analytics.cv_section_count(g.cv),
    analytics.cv_item_count(g.cv),
    analytics.cv_bullet_count(g.cv),
    jsonb_array_length(coalesce(g.cv->'skills', '[]'::jsonb)),
    jsonb_array_length(coalesce(g.cv->'hiddenSectionIds', '[]'::jsonb)),
    greatest(0, extract(epoch from (g.created_at - dj.created_at))::int),
    g.revision_number = 0,
    now()
  from public.generations g
  left join analytics.dim_job  dj on dj.job_id = g.job_id
  left join analytics.dim_user du on du.user_id = g.user_id
  left join analytics.dim_template dt on dt.template_code = g.template
  cross join lateral (
    select coalesce((g.diff->'gapAnalysis'->>'matchScore')::numeric, 0) = 0
       and jsonb_array_length(coalesce(g.diff->'gapAnalysis'->'strengths', '[]'::jsonb)) = 0
       and jsonb_array_length(coalesce(g.diff->'gapAnalysis'->'gaps', '[]'::jsonb)) = 0
      as missing) m
  where g.updated_at > v_wm
  on conflict (generation_id) do update set
    template_key           = excluded.template_key,
    source_updated_at      = excluded.source_updated_at,
    report_stale           = excluded.report_stale,
    is_sample              = excluded.is_sample,
    cv_theme               = excluded.cv_theme,
    split_view             = excluded.split_view,
    match_score            = excluded.match_score,
    match_score_is_missing = excluded.match_score_is_missing,
    cv_char_estimate       = excluded.cv_char_estimate,
    over_one_page          = excluded.over_one_page,
    change_count           = excluded.change_count,
    changes_added          = excluded.changes_added,
    changes_removed        = excluded.changes_removed,
    changes_modified       = excluded.changes_modified,
    changes_reordered      = excluded.changes_reordered,
    strength_count         = excluded.strength_count,
    gap_count              = excluded.gap_count,
    recommendation_count   = excluded.recommendation_count,
    sim_question_count     = excluded.sim_question_count,
    sim_pitch_chars        = excluded.sim_pitch_chars,
    section_count          = excluded.section_count,
    item_count             = excluded.item_count,
    bullet_count           = excluded.bullet_count,
    skill_count            = excluded.skill_count,
    hidden_section_count   = excluded.hidden_section_count,
    etl_updated_at         = now();

  get diagnostics v_n = row_count;
  perform analytics.wm_set('fact_generation', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_fact_answer(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('fact_answer', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(updated_at) into v_max from public.profile_answers;

  insert into analytics.fact_answer (
    answer_id, date_key, updated_date_key, user_key, question_key,
    source_job_key, question_variant_hash, occurred_at, updated_at, kind,
    topic, answer_char_count, selected_option_count, offered_option_count,
    used_other_option, is_ranked, is_revised, seconds_first_to_last,
    etl_updated_at)
  select
    pa.id,
    analytics.date_key(pa.created_at),
    analytics.date_key(pa.updated_at),
    coalesce(du.user_key, -1),
    coalesce(qv.question_key, -1),
    coalesce(dj.job_key, -1),
    md5(btrim(pa.question)),
    pa.created_at, pa.updated_at, pa.kind,
    nullif(pa.payload->>'topic', ''),
    length(coalesce(pa.answer, '')),
    coalesce(jsonb_array_length(pa.payload->'selected'), 0)::smallint,
    coalesce(jsonb_array_length(pa.payload->'options'), 0)::smallint,
    coalesce(pa.payload->'selected' @> '["__other__"]'::jsonb, false),
    coalesce(pa.payload->>'selectType', '') = 'ranked',
    pa.updated_at > pa.created_at + interval '1 second',
    greatest(0, extract(epoch from (pa.updated_at - pa.created_at))::int),
    now()
  from public.profile_answers pa
  left join analytics.dim_user du on du.user_id = pa.user_id
  left join analytics.question_variant qv on qv.variant_hash = md5(btrim(pa.question))
  left join analytics.dim_job dj on dj.job_id = pa.source_job_id
  where pa.updated_at > v_wm
  on conflict (answer_id) do update set
    question_key          = excluded.question_key,
    updated_date_key      = excluded.updated_date_key,
    updated_at            = excluded.updated_at,
    kind                  = excluded.kind,
    topic                 = excluded.topic,
    answer_char_count     = excluded.answer_char_count,
    selected_option_count = excluded.selected_option_count,
    offered_option_count  = excluded.offered_option_count,
    used_other_option     = excluded.used_other_option,
    is_ranked             = excluded.is_ranked,
    is_revised            = excluded.is_revised,
    seconds_first_to_last = excluded.seconds_first_to_last,
    etl_updated_at        = now();

  get diagnostics v_n = row_count;
  perform analytics.wm_set('fact_answer', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_fact_question_exposure(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('fact_question_exposure', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(occurred_at) into v_max from public.funnel_events;

  insert into analytics.fact_question_exposure (
    exposure_id, date_key, visitor_key, user_key, question_key,
    question_variant_hash, occurred_at, etl_updated_at)
  select
    fe.event_id || ':' || md5(btrim(t)),
    analytics.date_key(fe.occurred_at),
    coalesce(dv.visitor_key, -1),
    coalesce(du.user_key, -1),
    coalesce(qv.question_key, -1),
    md5(btrim(t)),
    fe.occurred_at,
    now()
  -- CROSS JOIN LATERAL, not a comma: with `fe, lateral t left join dv on ...`
  -- the LEFT JOIN binds only to `t`, and `fe` is out of scope in its ON clause.
  from public.funnel_events fe
  cross join lateral unnest(coalesce(fe.question_texts, '{}'::text[])) t
  left join analytics.dim_visitor dv on dv.visitor_id = fe.visitor_id
  left join analytics.dim_user    du on du.user_id = fe.user_id
  left join analytics.question_variant qv on qv.variant_hash = md5(btrim(t))
  where fe.event_type = 'questions_served'
    and btrim(coalesce(t, '')) <> ''
    and fe.occurred_at > v_wm
  on conflict (exposure_id) do update set
    question_key   = excluded.question_key,
    etl_updated_at = now();

  get diagnostics v_n = row_count;

  -- Latest-value semantics, recomputed rather than frozen at load.
  update analytics.fact_question_exposure e
     set was_answered_within_30d = true
    from analytics.fact_answer a
   where a.user_key = e.user_key
     and a.question_key = e.question_key
     and e.user_key <> -1
     and a.occurred_at between e.occurred_at and e.occurred_at + interval '30 days'
     and not e.was_answered_within_30d;

  perform analytics.wm_set('fact_question_exposure', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_fact_order(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('fact_order', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(updated_at) into v_max from public.orders;

  insert into analytics.fact_order (
    order_id, date_key, user_key, sku_key, occurred_at, source_updated_at,
    status, tier, provider_ref_present, amount_cents, upgrade_amount_cents,
    credits_total, credits_spent, credits_remaining, is_paid, is_pending,
    is_refunded, seconds_to_paid, etl_updated_at)
  select
    o.id,
    analytics.date_key(o.created_at),
    coalesce(du.user_key, -1),
    coalesce(ds.sku_key, -1),
    o.created_at, o.updated_at, o.status, o.tier,
    o.provider_ref is not null,
    o.amount_cents, o.upgrade_amount_cents,
    o.credits_total::smallint,
    spent.n::smallint,
    greatest(0, o.credits_total - spent.n)::smallint,
    o.status = 'paid', o.status = 'pending', o.status = 'refunded',
    case when o.status = 'paid'
         then greatest(0, extract(epoch from (o.updated_at - o.created_at))::int) end,
    now()
  from public.orders o
  left join analytics.dim_user du on du.user_id = o.user_id
  left join analytics.dim_sku  ds on ds.sku = o.sku
  cross join lateral (
    -- Derived exactly as src/lib/credits.ts derives it: no stored counter to
    -- drift, and a refund that deletes purchases returns the credits for free.
    select count(*)::int as n from public.purchases p where p.order_id = o.id) spent
  where o.updated_at > v_wm
  on conflict (order_id) do update set
    status               = excluded.status,
    source_updated_at    = excluded.source_updated_at,
    provider_ref_present = excluded.provider_ref_present,
    amount_cents         = excluded.amount_cents,
    upgrade_amount_cents = excluded.upgrade_amount_cents,
    credits_spent        = excluded.credits_spent,
    credits_remaining    = excluded.credits_remaining,
    is_paid              = excluded.is_paid,
    is_pending           = excluded.is_pending,
    is_refunded          = excluded.is_refunded,
    seconds_to_paid      = excluded.seconds_to_paid,
    etl_updated_at       = now();

  get diagnostics v_n = row_count;
  perform analytics.wm_set('fact_order', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_fact_purchase(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_wm timestamptz := analytics.wm_get('fact_purchase', p_full);
        v_max timestamptz; v_n bigint := 0;
begin
  select max(updated_at) into v_max from public.purchases;

  insert into analytics.fact_purchase (
    purchase_id, date_key, user_key, job_key, company_key, role_key, sku_key,
    order_key, order_id, occurred_at, source_updated_at, status, tier,
    amount_cents, is_paid, is_credit_spend, is_free_mode_grant,
    is_direct_purchase, is_abandoned_checkout, revisions_used, rewrites_used,
    report_regens_used, etl_updated_at)
  select
    p.id,
    analytics.date_key(p.created_at),
    coalesce(du.user_key, -1),
    coalesce(dj.job_key, -1),
    coalesce(dj.company_key, -1),
    coalesce(dj.role_key, -1),
    coalesce(fo.sku_key, -1),
    fo.order_key, p.order_id,
    p.created_at, p.updated_at, p.status, p.tier,
    p.amount_cents,
    p.status = 'paid',
    -- The three-way disambiguation of amount_cents = 0, encoded once.
    p.order_id is not null and p.amount_cents = 0,
    p.order_id is null and p.provider_ref is null and p.amount_cents = 0,
    p.amount_cents > 0 or p.provider_ref is not null,
    p.status = 'pending' and p.created_at < now() - interval '24 hours',
    p.revisions_used::smallint, p.rewrites_used::smallint,
    p.report_regens_used::smallint,
    now()
  from public.purchases p
  left join analytics.dim_user  du on du.user_id = p.user_id
  left join analytics.dim_job   dj on dj.job_id = p.job_id
  left join analytics.fact_order fo on fo.order_id = p.order_id
  where p.updated_at > v_wm
  on conflict (purchase_id) do update set
    status                = excluded.status,
    source_updated_at     = excluded.source_updated_at,
    order_key             = excluded.order_key,
    order_id              = excluded.order_id,
    sku_key               = excluded.sku_key,
    amount_cents          = excluded.amount_cents,
    is_paid               = excluded.is_paid,
    is_credit_spend       = excluded.is_credit_spend,
    is_free_mode_grant    = excluded.is_free_mode_grant,
    is_direct_purchase    = excluded.is_direct_purchase,
    is_abandoned_checkout = excluded.is_abandoned_checkout,
    revisions_used        = excluded.revisions_used,
    rewrites_used         = excluded.rewrites_used,
    report_regens_used    = excluded.report_regens_used,
    etl_updated_at        = now();

  get diagnostics v_n = row_count;
  perform analytics.wm_set('fact_purchase', v_max);
  return v_n;
end $fn$;

create or replace function analytics.refresh_fact_signup(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_n bigint := 0;
begin
  insert into analytics.fact_signup (
    user_id, date_key, user_key, signup_visitor_key, acquisition_key,
    device_key, auth_provider_key, occurred_at,
    seconds_first_visit_to_signup, visits_before_signup,
    jd_submissions_before_signup, hit_registration_wall_before_signup,
    jobs_in_first_run, had_anonymous_funnel, etl_updated_at)
  select
    du.user_id,
    du.signup_date_key,
    du.user_key,
    du.signup_visitor_key,
    dv.acquisition_key,
    dv.device_key,
    du.auth_provider_key,
    du.signup_at,
    case when dv.first_seen_at is not null
         then greatest(0, extract(epoch from (du.signup_at - dv.first_seen_at))::int) end,
    coalesce(pre.visits, 0),
    coalesce(pre.jds, 0),
    coalesce(pre.wall, false),
    coalesce(fr.jobs, 0)::smallint,
    du.signup_visitor_key <> -1,
    now()
  from analytics.dim_user du
  left join analytics.dim_visitor dv on dv.visitor_key = du.signup_visitor_key
  left join lateral (
    select count(*) filter (where f.occurred_at < du.signup_at)      as visits,
           0                                                          as jds,
           false                                                      as wall
      from analytics.fact_visit f
     where f.visitor_key = du.signup_visitor_key) pre on true
  left join lateral (
    select count(*) as jobs from public.jobs j
     where j.user_id = du.user_id
       and j.batch_id = (select j2.batch_id from public.jobs j2
                          where j2.user_id = du.user_id
                          order by j2.created_at asc limit 1)) fr on true
  where du.user_key <> -1 and du.signup_at is not null
  on conflict (user_id) do update set
    signup_visitor_key   = excluded.signup_visitor_key,
    acquisition_key      = excluded.acquisition_key,
    device_key           = excluded.device_key,
    auth_provider_key    = excluded.auth_provider_key,
    visits_before_signup = excluded.visits_before_signup,
    jobs_in_first_run    = excluded.jobs_in_first_run,
    had_anonymous_funnel = excluded.had_anonymous_funnel,
    etl_updated_at       = now();

  get diagnostics v_n = row_count;

  -- The two pre-signup funnel measures come from the raw event log, where the
  -- ordering against signup_at is exact.
  update analytics.fact_signup fs
     set jd_submissions_before_signup = c.jds,
         hit_registration_wall_before_signup = c.wall
    from (
      select vu.user_id,
             count(*) filter (where fe.event_type = 'jd_submitted')        as jds,
             bool_or(fe.event_type = 'registration_wall_hit')              as wall
        from public.visitor_users vu
        join public.funnel_events fe on fe.visitor_id = vu.visitor_id
        join auth.users au on au.id = vu.user_id
       where vu.is_signup_visitor and fe.occurred_at < au.created_at
       group by 1) c
   where c.user_id = fs.user_id;

  return v_n;
end $fn$;

-- Grain: (user, canonical question). Deterministic rebuild of a small slice.
create or replace function analytics.refresh_fact_user_question(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_n bigint := 0;
begin
  insert into analytics.fact_user_question (
    user_key, question_key, first_date_key, last_date_key, variant_count,
    total_answer_chars, has_mcq_answer, has_open_answer, first_answered_at,
    last_answered_at, days_between_first_and_last, etl_updated_at)
  select
    a.user_key,
    coalesce(q.merged_into_key, a.question_key),
    analytics.date_key(min(a.occurred_at)),
    analytics.date_key(max(a.updated_at)),
    count(distinct a.question_variant_hash)::smallint,
    sum(a.answer_char_count)::int,
    bool_or(a.kind = 'mcq'),
    bool_or(a.kind = 'open'),
    min(a.occurred_at),
    max(a.updated_at),
    greatest(0, extract(day from (max(a.updated_at) - min(a.occurred_at)))::int),
    now()
  from analytics.fact_answer a
  left join analytics.dim_question q on q.question_key = a.question_key
  where a.user_key <> -1
  group by a.user_key, coalesce(q.merged_into_key, a.question_key)
  on conflict (user_key, question_key) do update set
    last_date_key              = excluded.last_date_key,
    variant_count              = excluded.variant_count,
    total_answer_chars         = excluded.total_answer_chars,
    has_mcq_answer             = excluded.has_mcq_answer,
    has_open_answer            = excluded.has_open_answer,
    last_answered_at           = excluded.last_answered_at,
    days_between_first_and_last = excluded.days_between_first_and_last,
    etl_updated_at             = now();

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- ============================================================
-- Rollups onto the dimensions
-- ============================================================

create or replace function analytics.refresh_dim_rollups(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_n bigint := 0;
begin
  update analytics.dim_company c set
    raw_variant_count = s.variants, submission_count = s.subs,
    job_count = s.jobs, distinct_user_count = s.users,
    first_seen_at = s.first_at, last_seen_at = s.last_at, etl_updated_at = now()
  from (
    select f.company_key,
           count(*) filter (where f.is_first_for_visitor_jd)     as subs,
           count(distinct f.job_key) filter (where f.job_key <> -1) as jobs,
           count(distinct f.user_key) filter (where f.user_key <> -1) as users,
           min(f.occurred_at) as first_at, max(f.occurred_at) as last_at,
           (select count(*) from analytics.dim_company_alias a
             where a.company_key = f.company_key)                as variants
      from analytics.fact_jd_submission f group by f.company_key) s
  where s.company_key = c.company_key;

  update analytics.dim_role r set
    submission_count = s.subs, first_seen_at = s.first_at,
    last_seen_at = s.last_at, etl_updated_at = now()
  from (select role_key, count(*) filter (where is_first_for_visitor_jd) subs,
               min(occurred_at) first_at, max(occurred_at) last_at
          from analytics.fact_jd_submission group by 1) s
  where s.role_key = r.role_key;

  update analytics.dim_field f set submission_count = s.subs
  from (select field_key, count(*) subs from analytics.fact_jd_submission group by 1) s
  where s.field_key = f.field_key;

  update analytics.dim_question q set
    variant_count        = s.variants,
    answering_user_count = s.users,
    served_count         = s.served,
    predominant_kind     = s.kind,
    predominant_topic    = s.topic,
    last_seen_at         = s.last_at,
    etl_updated_at       = now()
  from (
    select d.question_key,
           (select count(*) from analytics.question_variant v where v.question_key = d.question_key) as variants,
           (select count(*) from analytics.fact_user_question uq where uq.question_key = d.question_key) as users,
           (select count(*) from analytics.fact_question_exposure e where e.question_key = d.question_key) as served,
           (select case when count(*) filter (where a.kind = 'mcq') > 0
                         and count(*) filter (where a.kind = 'open') > 0 then 'mixed'
                       when count(*) filter (where a.kind = 'mcq') > 0 then 'mcq'
                       when count(*) filter (where a.kind = 'open') > 0 then 'open' end
              from analytics.fact_answer a where a.question_key = d.question_key) as kind,
           (select a.topic from analytics.fact_answer a
             where a.question_key = d.question_key and a.topic is not null
             group by a.topic order by count(*) desc, a.topic asc limit 1) as topic,
           (select max(a.updated_at) from analytics.fact_answer a where a.question_key = d.question_key) as last_at
      from analytics.dim_question d where d.question_key <> -1) s
  where s.question_key = q.question_key;

  update analytics.dim_visitor v set
    jd_submission_count = s.jds, first_jd_at = s.first_jd, etl_updated_at = now()
  from (select visitor_key, count(*) filter (where is_first_for_visitor_jd) jds,
               min(occurred_at) first_jd
          from analytics.fact_jd_submission group by 1) s
  where s.visitor_key = v.visitor_key;

  update analytics.dim_user u set
    lifetime_jobs        = s.jobs,
    lifetime_generations = s.gens,
    lifetime_answers     = s.answers,
    lifetime_paid_cents  = s.cents,
    first_job_at         = least(coalesce(u.first_job_at, s.first_job), s.first_job),
    first_generation_at  = least(coalesce(u.first_generation_at, s.first_gen), s.first_gen),
    first_paid_at        = least(coalesce(u.first_paid_at, s.first_paid), s.first_paid),
    last_activity_at     = greatest(u.last_activity_at, s.last_act),
    etl_updated_at       = now()
  from (
    select du.user_key,
      (select count(*) from analytics.dim_job j where j.user_key = du.user_key and not j.is_deleted) as jobs,
      (select count(*) from analytics.fact_generation g where g.user_key = du.user_key) as gens,
      (select count(*) from analytics.fact_answer a where a.user_key = du.user_key) as answers,
      (select coalesce(sum(p.amount_cents), 0) from analytics.fact_purchase p where p.user_key = du.user_key and p.is_paid) as cents,
      (select min(j.created_at) from analytics.dim_job j where j.user_key = du.user_key) as first_job,
      (select min(g.occurred_at) from analytics.fact_generation g where g.user_key = du.user_key) as first_gen,
      (select min(p.occurred_at) from analytics.fact_purchase p where p.user_key = du.user_key and p.is_paid) as first_paid,
      (select max(x) from (values
        ((select max(g.occurred_at) from analytics.fact_generation g where g.user_key = du.user_key)),
        ((select max(a.updated_at)  from analytics.fact_answer a where a.user_key = du.user_key)),
        ((select max(v.occurred_at) from analytics.fact_visit v where v.user_key = du.user_key))
      ) as t(x)) as last_act
      from analytics.dim_user du where du.user_key <> -1) s
  where s.user_key = u.user_key;

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- ============================================================
-- fact_user_day
-- ============================================================
--
-- Dense per-user-per-day. Incrementally this rebuilds the trailing three days;
-- a full run rebuilds from each user's signup. Dense rather than sparse so a
-- retention curve is a join rather than a generate_series in every query.
create or replace function analytics.refresh_fact_user_day(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_from date := case when p_full then '2024-01-01'::date
                            else (current_date - 3) end;
        v_n bigint := 0;
begin
  insert into analytics.fact_user_day (
    user_key, date_key, jobs_created, generations_created, revisions_created,
    answers_added, answers_revised, purchases_paid, cents_paid, orders_paid,
    credits_purchased, credits_spent, visits, jd_submissions,
    credits_remaining, cum_jobs, cum_generations, cum_answers,
    cum_distinct_questions, cum_cents_paid, cum_purchases, days_since_signup,
    is_active_today, days_since_last_activity, lifecycle_stage, etl_updated_at)
  select
    u.user_key, d.date_key,
    x.jobs, x.gens, x.revs, x.ans_new, x.ans_rev, x.pur, x.cents, x.ord,
    x.cred_buy, x.cred_spend, x.vis, x.jds,
    c.credits_remaining, c.cum_jobs, c.cum_gens, c.cum_ans, c.cum_q,
    c.cum_cents, c.cum_pur,
    greatest(0, (d.full_date - u.signup_at::date)),
    (x.jobs + x.gens + x.ans_new + x.ans_rev + x.vis) > 0,
    case when c.last_act is not null then greatest(0, (d.full_date - c.last_act::date)) end,
    case
      when d.full_date - u.signup_at::date <= 7                            then 'new'
      when c.last_act is null or d.full_date - c.last_act::date > 90       then 'churned'
      when d.full_date - c.last_act::date > 30                             then 'dormant'
      else 'active' end,
    now()
  from analytics.dim_user u
  join analytics.dim_date d
    on d.full_date between greatest(u.signup_at::date, v_from) and current_date
  cross join lateral (
    select
      (select count(*) from analytics.dim_job j where j.user_key = u.user_key and j.created_date_key = d.date_key) as jobs,
      (select count(*) from analytics.fact_generation g where g.user_key = u.user_key and g.date_key = d.date_key) as gens,
      (select count(*) from analytics.fact_generation g where g.user_key = u.user_key and g.date_key = d.date_key and g.revision_number > 0) as revs,
      (select count(*) from analytics.fact_answer a where a.user_key = u.user_key and a.date_key = d.date_key) as ans_new,
      (select count(*) from analytics.fact_answer a where a.user_key = u.user_key and a.updated_date_key = d.date_key and a.is_revised) as ans_rev,
      (select count(*) from analytics.fact_purchase p where p.user_key = u.user_key and p.date_key = d.date_key and p.is_paid) as pur,
      (select coalesce(sum(p.amount_cents), 0) from analytics.fact_purchase p where p.user_key = u.user_key and p.date_key = d.date_key and p.is_paid) as cents,
      (select count(*) from analytics.fact_order o where o.user_key = u.user_key and o.date_key = d.date_key and o.is_paid) as ord,
      (select coalesce(sum(o.credits_total), 0) from analytics.fact_order o where o.user_key = u.user_key and o.date_key = d.date_key and o.is_paid) as cred_buy,
      (select count(*) from analytics.fact_purchase p where p.user_key = u.user_key and p.date_key = d.date_key and p.is_credit_spend) as cred_spend,
      (select count(*) from analytics.fact_visit v where v.user_key = u.user_key and v.date_key = d.date_key) as vis,
      (select count(*) from analytics.fact_jd_submission f where f.user_key = u.user_key and f.date_key = d.date_key and f.is_first_for_visitor_jd) as jds
  ) x
  cross join lateral (
    select
      (select coalesce(sum(o.credits_remaining), 0) from analytics.fact_order o where o.user_key = u.user_key and o.is_paid and o.date_key <= d.date_key) as credits_remaining,
      (select count(*) from analytics.dim_job j where j.user_key = u.user_key and j.created_date_key <= d.date_key) as cum_jobs,
      (select count(*) from analytics.fact_generation g where g.user_key = u.user_key and g.date_key <= d.date_key) as cum_gens,
      (select count(*) from analytics.fact_answer a where a.user_key = u.user_key and a.date_key <= d.date_key) as cum_ans,
      (select count(distinct a.question_key) from analytics.fact_answer a where a.user_key = u.user_key and a.date_key <= d.date_key) as cum_q,
      (select coalesce(sum(p.amount_cents), 0) from analytics.fact_purchase p where p.user_key = u.user_key and p.is_paid and p.date_key <= d.date_key) as cum_cents,
      (select count(*) from analytics.fact_purchase p where p.user_key = u.user_key and p.is_paid and p.date_key <= d.date_key) as cum_pur,
      (select max(g.occurred_at) from analytics.fact_generation g where g.user_key = u.user_key and g.date_key <= d.date_key) as last_act
  ) c
  where u.user_key <> -1 and u.signup_at is not null
  on conflict (user_key, date_key) do update set
    jobs_created           = excluded.jobs_created,
    generations_created    = excluded.generations_created,
    revisions_created      = excluded.revisions_created,
    answers_added          = excluded.answers_added,
    answers_revised        = excluded.answers_revised,
    purchases_paid         = excluded.purchases_paid,
    cents_paid             = excluded.cents_paid,
    orders_paid            = excluded.orders_paid,
    credits_purchased      = excluded.credits_purchased,
    credits_spent          = excluded.credits_spent,
    visits                 = excluded.visits,
    jd_submissions         = excluded.jd_submissions,
    credits_remaining      = excluded.credits_remaining,
    cum_jobs               = excluded.cum_jobs,
    cum_generations        = excluded.cum_generations,
    cum_answers            = excluded.cum_answers,
    cum_distinct_questions = excluded.cum_distinct_questions,
    cum_cents_paid         = excluded.cum_cents_paid,
    cum_purchases          = excluded.cum_purchases,
    is_active_today        = excluded.is_active_today,
    days_since_last_activity = excluded.days_since_last_activity,
    lifecycle_stage        = excluded.lifecycle_stage,
    etl_updated_at         = now();

  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- ============================================================
-- Deletion reconciliation — mandatory, not optional
-- ============================================================
--
-- An incremental load reads only rows newer than a watermark, and a deleted row
-- has no updated_at to be newer than. Without this step the warehouse would
-- NEVER notice a deletion. That is the single most commonly missed correctness
-- bug in an incremental warehouse, and here it is also a legal obligation:
-- /privacy promises erasure.
create or replace function analytics.refresh_reconcile_deletions(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_keys bigint[]; v_n bigint := 0;
begin
  select coalesce(array_agg(u.user_key), '{}') into v_keys
    from analytics.dim_user u
   where u.user_key <> -1
     and (u.user_id in (select user_id from public.deleted_user_tombstones
                         where warehouse_purged_at is null)
          or not exists (select 1 from auth.users a where a.id = u.user_id));

  if cardinality(v_keys) = 0 then return 0; end if;

  delete from analytics.fact_user_day      where user_key = any (v_keys);
  delete from analytics.fact_user_question where user_key = any (v_keys);
  delete from analytics.fact_answer        where user_key = any (v_keys);
  delete from analytics.fact_purchase      where user_key = any (v_keys);
  delete from analytics.fact_order         where user_key = any (v_keys);
  delete from analytics.fact_generation    where user_key = any (v_keys);
  delete from analytics.fact_signup        where user_key = any (v_keys);
  delete from analytics.fact_question_exposure where user_key = any (v_keys);

  -- Traffic facts are UNLINKED, not deleted. Once the user key and the visitor
  -- row are gone the row is genuinely anonymous, and deleting it would rewrite
  -- historical traffic totals retroactively — punishing everyone's charts to
  -- honour one person's request, when unlinking already honours it.
  update analytics.fact_visit
     set user_key = -1, visitor_key = -1 where user_key = any (v_keys);
  update analytics.fact_jd_submission
     set user_key = -1, visitor_key = -1 where user_key = any (v_keys);

  update analytics.dim_job set user_key = -1 where user_key = any (v_keys);
  delete from analytics.dim_visitor where signup_user_key = any (v_keys);
  delete from analytics.dim_user   where user_key = any (v_keys);
  get diagnostics v_n = row_count;

  update public.deleted_user_tombstones
     set warehouse_purged_at = now() where warehouse_purged_at is null;

  return v_n;
end $fn$;

-- Visitors that no longer exist upstream.
--
-- Separate from the user reconciliation above because it needs a different
-- rule, and getting that rule wrong would destroy history. public.visitors is
-- retained FOREVER — retention only ever deletes visits and funnel_events — so
-- an anti-join against it is safe: a missing visitor really is a deletion, not
-- an expiry. The same anti-join against public.visits would NOT be safe, because
-- at 400 days retention removes the source rows on purpose while the warehouse
-- goes on being the archive. So fact_visit is pruned only for visitors that are
-- genuinely gone, never for visits that merely aged out.
--
-- This is also what finishes the job purge_visitor_data starts: that function
-- deletes visitor rows, and until now only the ones belonging to an account
-- were followed into the warehouse.
create or replace function analytics.refresh_reconcile_visitors(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_keys bigint[]; v_n bigint := 0;
begin
  select coalesce(array_agg(dv.visitor_key), '{}') into v_keys
    from analytics.dim_visitor dv
   where dv.visitor_key <> -1
     and not exists (select 1 from public.visitors v
                      where v.visitor_id = dv.visitor_id);

  if cardinality(v_keys) = 0 then return 0; end if;

  delete from analytics.fact_visit where visitor_key = any (v_keys);
  delete from analytics.fact_question_exposure where visitor_key = any (v_keys);
  -- A job submission outlives the browser that made it: the job is still real.
  update analytics.fact_jd_submission set visitor_key = -1 where visitor_key = any (v_keys);
  update analytics.dim_job set origin_visitor_key = -1 where origin_visitor_key = any (v_keys);
  update analytics.fact_signup set signup_visitor_key = -1 where signup_visitor_key = any (v_keys);
  update analytics.dim_user set signup_visitor_key = -1 where signup_visitor_key = any (v_keys);

  delete from analytics.dim_visitor where visitor_key = any (v_keys);
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

-- ============================================================
-- Retention — runs at most once per UTC day
-- ============================================================
create or replace function analytics.refresh_apply_retention(p_full boolean default false)
returns bigint language plpgsql as
$fn$
declare v_last timestamptz; v_n bigint := 0; v_t bigint;
begin
  select last_run_at into v_last from analytics.etl_watermark
   where step_name = 'apply_retention';
  if v_last is not null
     and (v_last at time zone 'utc')::date = (now() at time zone 'utc')::date then
    return 0;
  end if;

  -- question_texts goes early: it is the one PII-bearing column kept on purpose,
  -- and it stops being useful long before the row itself does.
  update public.funnel_events set question_texts = null
   where question_texts is not null and occurred_at < now() - interval '180 days';
  get diagnostics v_t = row_count; v_n := v_n + v_t;

  update public.visits set ip_hash = null, ua_hash = null
   where (ip_hash is not null or ua_hash is not null)
     and started_at < now() - interval '90 days';
  get diagnostics v_t = row_count; v_n := v_n + v_t;

  delete from public.funnel_events where occurred_at < now() - interval '400 days';
  get diagnostics v_t = row_count; v_n := v_n + v_t;

  delete from public.visits where started_at < now() - interval '400 days';
  get diagnostics v_t = row_count; v_n := v_n + v_t;

  delete from public.deleted_user_tombstones
   where warehouse_purged_at is not null
     and warehouse_purged_at < now() - interval '30 days';
  get diagnostics v_t = row_count; v_n := v_n + v_t;

  return v_n;
end $fn$;

-- ============================================================
-- The driver
-- ============================================================
create or replace function analytics.refresh_all(p_full boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = analytics, public, pg_temp
as $fn$
declare
  v_run    bigint;
  v_step   text;
  v_ok     int := 0;
  v_fail   int := 0;
  v_detail jsonb := '{}'::jsonb;
  v_t0     timestamptz;
  v_rows   bigint;
  v_steps  text[] := array[
    -- Conformed dimensions built from free text, first: the facts need their keys.
    'dim_company','dim_role','dim_field','dim_question',
    'dim_acquisition','dim_device',
    -- Entity dimensions.
    'dim_visitor','dim_user','dim_run','dim_job',
    -- Facts. fact_order before fact_purchase (purchase reads its order key).
    'fact_visit','fact_jd_submission','fact_generation','fact_answer',
    'fact_order','fact_purchase','fact_signup','fact_question_exposure',
    -- Derived from facts.
    'fact_user_question','fact_user_day',
    -- Housekeeping.
    'dim_rollups','reconcile_deletions','reconcile_visitors','apply_retention'];
begin
  -- One refresh at a time. An overlapping cron tick no-ops instead of racing
  -- assign_question into creating duplicate cluster leaders.
  if not pg_try_advisory_lock(hashtext('analytics.refresh_all')::bigint) then
    insert into analytics.etl_run_log (status, finished_at)
    values ('skipped_locked', now());
    return jsonb_build_object('status', 'skipped_locked');
  end if;

  insert into analytics.etl_run_log (status) values ('running') returning run_id into v_run;

  foreach v_step in array v_steps loop
    v_t0 := clock_timestamp();
    begin
      -- Each step is its own subtransaction: one bad step degrades the refresh,
      -- it does not abort it, and the watermark it failed to advance means the
      -- next run simply retries the same window.
      execute format('select analytics.refresh_%I($1)', v_step) into v_rows using p_full;

      insert into analytics.etl_watermark (
        step_name, last_run_at, last_row_count, last_duration_ms,
        last_error, consecutive_failures)
      values (v_step, now(), v_rows,
              (extract(epoch from clock_timestamp() - v_t0) * 1000)::int, null, 0)
      on conflict (step_name) do update set
        last_run_at          = excluded.last_run_at,
        last_row_count       = excluded.last_row_count,
        last_duration_ms     = excluded.last_duration_ms,
        last_error           = null,
        consecutive_failures = 0;

      v_ok := v_ok + 1;
      v_detail := v_detail || jsonb_build_object(v_step, v_rows);
    exception when others then
      v_fail := v_fail + 1;
      insert into analytics.etl_watermark (
        step_name, last_run_at, last_error, consecutive_failures)
      values (v_step, now(), sqlerrm, 1)
      on conflict (step_name) do update set
        last_run_at          = excluded.last_run_at,
        last_error           = excluded.last_error,
        consecutive_failures = analytics.etl_watermark.consecutive_failures + 1;
      v_detail := v_detail || jsonb_build_object(v_step, 'ERROR: ' || sqlerrm);
    end;
  end loop;

  update analytics.etl_run_log
     set finished_at = now(), steps_ok = v_ok, steps_failed = v_fail,
         status = case when v_fail = 0 then 'ok' else 'partial' end,
         detail = v_detail
   where run_id = v_run;

  perform pg_advisory_unlock(hashtext('analytics.refresh_all')::bigint);
  return jsonb_build_object('run_id', v_run, 'ok', v_ok,
                            'failed', v_fail, 'detail', v_detail);
end $fn$;

revoke all on function analytics.refresh_all(boolean) from public, anon, authenticated;
grant execute on function analytics.refresh_all(boolean) to service_role;

grant all on all tables in schema analytics to service_role;
grant all on all sequences in schema analytics to service_role;

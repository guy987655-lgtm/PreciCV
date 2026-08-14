-- 0014 — the four functions that write the capture layer.
--
-- Nothing in the application writes public.visitors / visits / funnel_events /
-- visitor_users directly. Those tables grant nothing to anon or authenticated
-- (0013), so every write goes through one of these, called with the service
-- role. Each is security definer with a pinned search_path, following the
-- spend_credit() precedent in 0010 — a security definer function without the
-- pin is hijackable through a caller-controlled search_path.
--
-- All four are written to fail quietly on a null visitor rather than raise:
-- analytics must never break a user flow.

-- ============================================================
-- touch_visit: resolve (and if needed open) the current session
-- ============================================================
--
-- SESSION BOUNDARY — 30 minutes of inactivity, a hard cut at UTC midnight,
-- and a 12-hour cap.
--
--   30 minutes  matches the rhythm of this product: upload a CV, paste job
--               descriptions, answer questions is a 5-20 minute stretch.
--   UTC midnight guarantees a visit belongs to exactly one calendar day, so
--               every daily rollup stays additive. The cost is that a session
--               spanning midnight becomes two visits; a visit that has to be
--               apportioned across two dates is worse.
--   12 hours    defends against a pinned tab whose beacon keeps firing.
--
-- The database is the authority, not a second cookie. A signed visit cookie
-- would add a signature, a sliding Max-Age on every response and a clock the
-- client controls, and would save nothing: recording an event needs a round
-- trip here anyway, so this may as well be what resolves the visit.
create or replace function public.touch_visit(
  p_visitor        uuid,
  p_ctx            jsonb   default '{}'::jsonb,
  p_server_created boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_visit uuid;
begin
  if p_visitor is null then return null; end if;

  -- The first-touch columns are written by this INSERT and never again: the
  -- DO UPDATE branch touches only the two timestamps. That is what makes
  -- attribution survive a multi-visit journey.
  insert into public.visitors (
    visitor_id, first_landing_path, first_referrer_host,
    first_utm_source, first_utm_medium, first_utm_campaign,
    first_utm_term, first_utm_content, first_country,
    first_device_type, first_os_family, first_browser_family, first_lang,
    cookie_signed, bot_suspect)
  values (
    p_visitor,
    p_ctx->>'path',        p_ctx->>'referrer_host',
    p_ctx->>'utm_source',  p_ctx->>'utm_medium',  p_ctx->>'utm_campaign',
    p_ctx->>'utm_term',    p_ctx->>'utm_content', p_ctx->>'country',
    p_ctx->>'device_type', p_ctx->>'os_family',   p_ctx->>'browser_family',
    p_ctx->>'lang',
    coalesce((p_ctx->>'cookie_signed')::boolean, true),
    coalesce((p_ctx->>'bot_suspect')::boolean, false))
  on conflict (visitor_id) do update
    set last_seen_at = now(), updated_at = now();

  -- Reuse the open visit if there is one. FOR UPDATE (not SKIP LOCKED): two
  -- tabs of the same browser must land on the SAME visit, so the loser of the
  -- race has to wait and then find the row, not skip past it.
  select visit_id into v_visit
    from public.visits
   where visitor_id  = p_visitor
     and last_seen_at > now() - interval '30 minutes'
     and visit_date   = (now() at time zone 'utc')::date
     and started_at   > now() - interval '12 hours'
   order by last_seen_at desc
   limit 1
   for update;

  if found then
    update public.visits
       set last_seen_at = now(),
           -- Page hits are beacon pings only. An API route extending the
           -- session is an event, not a page view, and counting it here would
           -- quietly inflate page_hit_count in the warehouse.
           hit_count    = hit_count + case when p_server_created then 0 else 1 end,
           updated_at   = now()
     where visit_id = v_visit;
  else
    insert into public.visits (
      visitor_id, entry_path, referrer_host,
      utm_source, utm_medium, utm_campaign, utm_term, utm_content,
      country, device_type, os_family, browser_family, lang,
      ip_hash, ua_hash, bot_suspect, server_created, hit_count)
    values (
      p_visitor, p_ctx->>'path', p_ctx->>'referrer_host',
      p_ctx->>'utm_source', p_ctx->>'utm_medium', p_ctx->>'utm_campaign',
      p_ctx->>'utm_term',   p_ctx->>'utm_content',
      p_ctx->>'country',    p_ctx->>'device_type', p_ctx->>'os_family',
      p_ctx->>'browser_family', p_ctx->>'lang',
      p_ctx->>'ip_hash',    p_ctx->>'ua_hash',
      coalesce((p_ctx->>'bot_suspect')::boolean, false),
      p_server_created,
      case when p_server_created then 0 else 1 end)
    returning visit_id into v_visit;

    update public.visitors
       set visit_count = visit_count + 1
     where visitor_id = p_visitor;
  end if;

  return v_visit;
end $fn$;

-- ============================================================
-- record_funnel_event: one server-side milestone
-- ============================================================
create or replace function public.record_funnel_event(
  p_visitor uuid,
  p_event   text,
  p_ctx     jsonb default '{}'::jsonb,
  p_payload jsonb default '{}'::jsonb,
  p_user    uuid  default null
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_visit uuid;
  v_id    bigint;
begin
  if p_visitor is null or p_event is null then return null; end if;

  -- API routes EXTEND a visit; they open one only when none is live. Passing
  -- server_created keeps that rare API-first session flagged and countable
  -- instead of masquerading as a page view.
  v_visit := public.touch_visit(p_visitor, p_ctx, true);

  insert into public.funnel_events (
    visitor_id, visit_id, user_id, event_type,
    jd_hash, jd_chars, jd_words, role_raw, company_raw, field_raw, same_field,
    cv_chars, cv_file_ext, mcq_served, open_served, question_texts,
    job_count, http_status, duration_ms, props)
  values (
    p_visitor, v_visit, p_user, p_event,
    nullif(p_payload->>'jd_hash', ''),
    (p_payload->>'jd_chars')::int,
    (p_payload->>'jd_words')::int,
    nullif(p_payload->>'role_raw', ''),
    nullif(p_payload->>'company_raw', ''),
    nullif(p_payload->>'field_raw', ''),
    (p_payload->>'same_field')::boolean,
    (p_payload->>'cv_chars')::int,
    nullif(p_payload->>'cv_file_ext', ''),
    (p_payload->>'mcq_served')::int,
    (p_payload->>'open_served')::int,
    case when p_payload ? 'question_texts'
         then (select array_agg(x) from jsonb_array_elements_text(p_payload->'question_texts') x)
    end,
    (p_payload->>'job_count')::int,
    (p_payload->>'http_status')::int,
    (p_payload->>'duration_ms')::int,
    coalesce(p_payload->'props', '{}'::jsonb))
  -- Absorbs funnel_events_jd_dedupe_uidx: a job description already recorded
  -- for this visit is not a second submission.
  on conflict do nothing
  returning event_id into v_id;

  if v_id is not null then
    update public.visits
       set event_count     = event_count + 1,
           user_id         = coalesce(user_id, p_user),
           signup_in_visit = signup_in_visit or (p_event = 'signup_linked'),
           updated_at      = now()
     where visit_id = v_visit;

    update public.visitors
       set event_count = event_count + 1,
           updated_at  = now()
     where visitor_id = p_visitor;
  end if;

  return v_id;
end $fn$;

-- ============================================================
-- link_visitor_user: the permanent pairing, claimed once
-- ============================================================
--
-- Called from the OAuth callback, which is the only place that knows both ids
-- at the same instant. The visitor cookie is SameSite=Lax and the callback is
-- a top-level GET navigation back from the provider, so the id survives the
-- round trip — that is what makes this implementable at all.
--
-- Every login re-links (link_count goes up), but the signup slot is claimed
-- exactly once. There is no trigger on auth.users and no "first ever login"
-- flag anywhere in this codebase, so a fresh auth.users.created_at is the best
-- available signal; the partial unique index in 0013 is what makes the claim
-- permanent regardless.
create or replace function public.link_visitor_user(
  p_visitor         uuid,
  p_user            uuid,
  p_user_created_at timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_has_signup boolean;
begin
  if p_visitor is null or p_user is null then return; end if;

  insert into public.visitor_users (visitor_id, user_id)
  values (p_visitor, p_user)
  on conflict (visitor_id, user_id) do update
    set last_linked_at = now(),
        link_count     = public.visitor_users.link_count + 1;

  select exists (
    select 1 from public.visitor_users
     where user_id = p_user and is_signup_visitor
  ) into v_has_signup;

  if not v_has_signup
     and p_user_created_at is not null
     and p_user_created_at > now() - interval '10 minutes' then
    begin
      update public.visitor_users
         set is_signup_visitor = true
       where visitor_id = p_visitor and user_id = p_user;
    exception when unique_violation then
      -- Lost the race to a concurrent callback. The other one is just as
      -- correct; there is nothing to fix.
      null;
    end;
  end if;
end $fn$;

-- ============================================================
-- purge_visitor_data: erasure
-- ============================================================
--
-- Called from /api/account/delete BEFORE admin.auth.admin.deleteUser(). The
-- cascade from auth.users would clear user_id references but would leave the
-- visitor rows themselves — and once a visitor_id is permanently linked to an
-- identified person, the visitor id IS personal data. /privacy promises it is
-- gone, so it has to actually go.
--
-- A visitor shared with another account (one laptop, two people) is NOT
-- deleted: the link row and this user's own visits and events are removed, and
-- the browser itself survives for the other account. Deleting it would erase a
-- third party's history to satisfy this request.
create or replace function public.purge_visitor_data(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_exclusive uuid[];
  v_n integer;
begin
  if p_user is null then return 0; end if;

  select coalesce(array_agg(vu.visitor_id), '{}') into v_exclusive
    from public.visitor_users vu
   where vu.user_id = p_user
     and not exists (
       select 1 from public.visitor_users other
        where other.visitor_id = vu.visitor_id
          and other.user_id <> p_user);

  delete from public.funnel_events
   where visitor_id = any (v_exclusive) or user_id = p_user;

  delete from public.visits
   where visitor_id = any (v_exclusive) or user_id = p_user;

  delete from public.visitor_users where user_id = p_user;

  delete from public.visitors where visitor_id = any (v_exclusive);
  get diagnostics v_n = row_count;

  -- The warehouse cannot detect a deletion on its own: an incremental load
  -- only ever reads rows newer than a watermark, and a deleted row has no
  -- updated_at to be newer than. This is how the erasure travels forward.
  insert into public.deleted_user_tombstones (user_id, deleted_at)
  values (p_user, now())
  on conflict (user_id) do nothing;

  return v_n;
end $fn$;

-- ============================================================
-- Grants: service role only
-- ============================================================
revoke all on function public.touch_visit(uuid, jsonb, boolean)          from public, anon, authenticated;
revoke all on function public.record_funnel_event(uuid, text, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.link_visitor_user(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.purge_visitor_data(uuid)                   from public, anon, authenticated;

grant execute on function public.touch_visit(uuid, jsonb, boolean)          to service_role;
grant execute on function public.record_funnel_event(uuid, text, jsonb, jsonb, uuid) to service_role;
grant execute on function public.link_visitor_user(uuid, uuid, timestamptz) to service_role;
grant execute on function public.purge_visitor_data(uuid)                   to service_role;

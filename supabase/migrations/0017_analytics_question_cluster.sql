-- 0017 — the question dimension.
--
-- "A table of unique questions, and which users answered each" is the hardest
-- thing in this warehouse, because the product has no stable question id. The
-- LLM invents ids per flow: the same id can mean two different questions across
-- flows, and the same question can come back under a new id. The app already
-- knows this — src/lib/answer-stats.ts dedupes by normalized TEXT and says so,
-- and public.profile_answers keys on (user_id, question) rather than any id.
--
-- So the dimension clusters by text, using the SAME rule the product uses to
-- decide whether a remembered answer can be reused for a new question
-- (isSimilarQuestion in src/lib/text.ts). Reproducing it exactly matters more
-- than improving on it: if analytics said two questions were one and the
-- product treated them as two, every answer-rate number would disagree with
-- what users actually experienced.
--
-- Ordered before the facts because fact_answer references dim_question.

-- ============================================================
-- The similarity functions — a faithful port of src/lib/text.ts
-- ============================================================

-- norm() in text.ts is `s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()`.
--
-- The character class is spelled out rather than written as a-z0-9 because a
-- RANGE inside a bracket expression is collation-dependent in PostgreSQL: under
-- some ICU collations [a-z] can match accented letters, which would silently
-- diverge from JavaScript's strictly-ASCII behaviour. Enumerating removes the
-- question entirely.
create or replace function analytics.q_norm(p text)
returns text language sql immutable parallel safe as
$fn$
  select btrim(regexp_replace(lower(coalesce(p, '')),
                              '[^abcdefghijklmnopqrstuvwxyz0123456789]+', ' ', 'g'))
$fn$;

create or replace function analytics.q_tokens(p text)
returns text[] language sql immutable parallel safe as
$fn$
  select coalesce(
    (select array_agg(distinct t order by t)
       from unnest(string_to_array(analytics.q_norm(p), ' ')) t
      where t <> ''),
    '{}'::text[])
$fn$;

create or replace function analytics.q_jaccard(a text[], b text[])
returns numeric language sql immutable parallel safe as
$fn$
  select case
    when a is null or b is null or cardinality(a) = 0 or cardinality(b) = 0
      then 0::numeric
    else (
      select i.c / (cardinality(a) + cardinality(b) - i.c)
        from (select count(*)::numeric as c
                from (select unnest(a) intersect select unnest(b)) x) i)
  end
$fn$;

-- isSimilarQuestion(a, b, 0.6): looseMatch first — normalized equality or
-- SUBSTRING containment, not token containment — then Jaccard on the token sets.
--
-- The empty-normalization guard is not defensive coding, it is fidelity. See
-- the note on q_norm's ASCII behaviour below; text.ts returns false whenever
-- either side normalizes to '', and so must this.
create or replace function analytics.q_similar(a text, b text, thr numeric default 0.6)
returns boolean language plpgsql immutable parallel safe as
$fn$
declare
  na text := analytics.q_norm(a);
  nb text := analytics.q_norm(b);
begin
  if na = '' or nb = '' then return false; end if;
  if na = nb then return true; end if;
  if position(nb in na) > 0 or position(na in nb) > 0 then return true; end if;
  return analytics.q_jaccard(analytics.q_tokens(a), analytics.q_tokens(b)) >= thr;
end $fn$;

-- ============================================================
-- dim_question
-- ============================================================
--
-- Grain: one canonical question cluster.
--
-- is_unmatchable flags the questions whose normalized form is empty. That is
-- every question written in Hebrew, because norm() strips all non-ASCII: two
-- character-for-character identical Hebrew questions do not match each other in
-- the product today. The warehouse reproduces that (each becomes its own
-- singleton cluster) so the numbers describe the product as it actually
-- behaves — but the flag exists precisely so the size of that blind spot is
-- measurable rather than invisible.
create table if not exists analytics.dim_question (
  question_key            bigint generated always as identity primary key,
  canonical_question_text text not null,
  canonical_hash          text not null unique,
  canonical_norm          text not null default '',
  canonical_tokens        text[] not null default '{}'::text[],
  is_unmatchable          boolean not null default false,

  predominant_kind        text,
  predominant_topic       text,
  variant_count           integer not null default 0,
  answering_user_count    integer not null default 0,
  served_count            integer not null default 0,

  first_seen_at           timestamptz not null default now(),
  last_seen_at            timestamptz,
  merged_into_key         bigint references analytics.dim_question (question_key),
  curated                 boolean not null default false,
  etl_updated_at          timestamptz not null default now()
);

insert into analytics.dim_question (
  question_key, canonical_question_text, canonical_hash, is_unmatchable)
overriding system value
values (-1, '(unknown)', '(unknown)', true)
on conflict (question_key) do nothing;

-- The blocking index. Without it, every new question text is a full scan of the
-- leader set; with it, only leaders sharing at least one token are considered.
create index if not exists dim_question_tokens_gin
  on analytics.dim_question using gin (canonical_tokens);

-- ============================================================
-- question_variant
-- ============================================================
--
-- Grain: one distinct raw question string, ever.
--
-- INSERT-ONLY. Nothing updates question_key on an existing variant, and that is
-- the stability guarantee: a text that mapped to cluster 42 last month still
-- maps to 42 today, so a chart built on question_key does not reshuffle itself
-- when new wordings arrive.
create table if not exists analytics.question_variant (
  variant_hash     text primary key,
  variant_text     text not null,
  variant_norm     text not null default '',
  variant_tokens   text[] not null default '{}'::text[],
  question_key     bigint not null references analytics.dim_question (question_key),
  assigned_by      text not null default 'new'
                   check (assigned_by in ('exact', 'similar', 'new', 'human')),
  first_seen_at    timestamptz not null default now(),
  occurrence_count integer not null default 0
);

create index if not exists question_variant_key_idx
  on analytics.question_variant (question_key);

-- ============================================================
-- assign_question
-- ============================================================
--
-- Three paths: exact hit, similar to an existing leader, or a new leader.
--
-- Three invariants keep cluster keys stable forever:
--   1. a question_variant row is never re-pointed;
--   2. a leader's text and key are set at creation and never touched again;
--   3. a new variant can only attach to the oldest matching leader, or become
--      one — never split, rename or renumber an existing cluster.
--
-- This is greedy leader clustering, and under a non-transitive similarity
-- relation it is order-dependent: if A and C both resemble B but not each other,
-- whichever arrives first becomes the leader. That is NOT a flaw to apologise
-- for — it is exactly what matchAnswers does in src/lib/answer-match.ts, which
-- scans a newest-first list and takes the first hit. There is no order-
-- independent ground truth here to be faithful to instead.
--
-- What makes it manageable is determinism: the ETL feeds distinct texts in a
-- fixed order, so two rebuilds from the same data produce identical keys.
--
-- Called only from inside refresh_all(), which holds an advisory lock, so the
-- read-then-insert is serialized by construction. Do not call it from a route.
create or replace function analytics.assign_question(p_text text)
returns bigint
language plpgsql
security definer
set search_path = analytics, public, pg_temp
as $fn$
declare
  v_text text := btrim(coalesce(p_text, ''));
  v_hash text;
  v_key  bigint;
  v_norm text;
  v_toks text[];
begin
  if v_text = '' then return -1; end if;
  v_hash := md5(v_text);

  -- (1) Exact. The fast path for the overwhelming majority of calls, and the
  --     reason a full refresh is cheap.
  select question_key into v_key
    from analytics.question_variant where variant_hash = v_hash;
  if found then return v_key; end if;

  v_norm := analytics.q_norm(v_text);
  v_toks := analytics.q_tokens(v_text);

  -- (2) Similar to an existing leader. The && prefilter is index-backed and
  --     provably safe for the Jaccard branch: a score of 0.6 or more requires
  --     at least one shared token. It is very slightly optimistic for the
  --     substring branch (a normalized string could sit inside a longer token
  --     while sharing no whole token), which real sentence-shaped questions do
  --     not do — and sanity check S9 measures whether that ever stops being true.
  if v_norm <> '' then
    select d.question_key into v_key
      from analytics.dim_question d
     where d.canonical_tokens && v_toks
       and not d.is_unmatchable
       and d.question_key <> -1
       and analytics.q_similar(d.canonical_question_text, v_text)
     order by d.first_seen_at asc, d.question_key asc
     limit 1;
  end if;

  -- (3) A new leader. Its text and key are frozen from this moment.
  if v_key is null then
    insert into analytics.dim_question (
      canonical_question_text, canonical_hash, canonical_norm,
      canonical_tokens, is_unmatchable, first_seen_at)
    values (v_text, v_hash, v_norm, v_toks, v_norm = '', now())
    on conflict (canonical_hash) do update set etl_updated_at = now()
    returning question_key into v_key;
  end if;

  insert into analytics.question_variant (
    variant_hash, variant_text, variant_norm, variant_tokens,
    question_key, assigned_by)
  values (
    v_hash, v_text, v_norm, v_toks, v_key,
    case when md5(v_text) = (select canonical_hash from analytics.dim_question
                              where question_key = v_key)
         then 'new' else 'similar' end)
  on conflict (variant_hash) do nothing;

  return v_key;
end $fn$;

-- ============================================================
-- rebuild_question_dimension
-- ============================================================
--
-- Replays every distinct question text in a deterministic order and rebuilds
-- the clusters from scratch. Needed when the threshold changes, or when the
-- ambiguity check (S8) says the greedy assignment has drifted.
--
-- Safe to run because facts store question_variant_hash alongside question_key:
-- a fact's durable identity is the raw text it came from, not the cluster it
-- was filed under, so the keys can be re-derived afterwards. That column is the
-- entire reason a rebuild is a maintenance operation rather than a data loss.
create or replace function analytics.rebuild_question_dimension()
returns bigint
language plpgsql
security definer
set search_path = analytics, public, pg_temp
as $fn$
declare
  r record;
  v_n bigint := 0;
begin
  delete from analytics.question_variant;
  delete from analytics.dim_question where question_key <> -1;

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
     group by q.text
     -- Fixed feed order: oldest first, hash as the tiebreak. Two rebuilds from
     -- the same data therefore produce byte-identical keys.
     order by min(q.seen) asc, md5(q.text) asc
  loop
    perform analytics.assign_question(r.text);
    v_n := v_n + 1;
  end loop;

  -- Re-point the facts at their (possibly renumbered) clusters. Guarded because
  -- this function is created before the fact tables exist.
  if to_regclass('analytics.fact_answer') is not null then
    execute $sql$
      update analytics.fact_answer f
         set question_key = v.question_key
        from analytics.question_variant v
       where v.variant_hash = f.question_variant_hash
         and f.question_key is distinct from v.question_key
    $sql$;
  end if;

  if to_regclass('analytics.fact_question_exposure') is not null then
    execute $sql$
      update analytics.fact_question_exposure f
         set question_key = v.question_key
        from analytics.question_variant v
       where v.variant_hash = f.question_variant_hash
         and f.question_key is distinct from v.question_key
    $sql$;
  end if;

  return v_n;
end $fn$;

-- ============================================================
-- v_question — always read questions through this
-- ============================================================
--
-- Resolves merged_into_key, so a human merging two clusters is one UPDATE that
-- applies retroactively across all history with no fact rewrite.
create or replace view analytics.v_question as
select
  q.question_key,
  coalesce(m.question_key, q.question_key)                       as resolved_question_key,
  coalesce(m.canonical_question_text, q.canonical_question_text) as question_text,
  q.is_unmatchable,
  q.variant_count,
  q.predominant_kind,
  q.predominant_topic,
  q.answering_user_count,
  q.served_count,
  q.first_seen_at,
  q.last_seen_at
from analytics.dim_question q
left join analytics.dim_question m on m.question_key = q.merged_into_key;

revoke all on function analytics.assign_question(text) from public, anon, authenticated;
revoke all on function analytics.rebuild_question_dimension() from public, anon, authenticated;
grant execute on function analytics.assign_question(text) to service_role;
grant execute on function analytics.rebuild_question_dimension() to service_role;

grant all on all tables in schema analytics to service_role;
grant all on all sequences in schema analytics to service_role;

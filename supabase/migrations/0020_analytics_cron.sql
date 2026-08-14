-- 0020 — the schedule.
--
-- pg_cron must be enabled once for the project: Supabase dashboard ->
-- Database -> Extensions -> pg_cron. The CREATE EXTENSION below does the same
-- thing when run as the postgres role, which the SQL editor is.
--
-- Jobs run in the postgres database as the postgres role. refresh_all() is
-- security definer, so that is sufficient — the cron job does not need any
-- grant of its own.

create extension if not exists pg_cron;

-- Unscheduling a job that does not exist raises, which would abort a re-run of
-- this file. Swallowing it is what makes the migration safe to paste twice.
do $$ begin
  perform cron.unschedule('analytics-refresh-hourly');
exception when others then null; end $$;

do $$ begin
  perform cron.unschedule('analytics-refresh-full-weekly');
exception when others then null; end $$;

-- Seven minutes past, not on the hour: the top of the hour is when every other
-- scheduled thing in the world runs, and there is no reason to queue behind it.
select cron.schedule(
  'analytics-refresh-hourly',
  '7 * * * *',
  $cron$select analytics.refresh_all(false);$cron$);

-- Sunday 03:17 UTC. A full pass rebuilds the windowed steps (fact_user_day only
-- looks at the trailing three days incrementally) and gives any step that has
-- been failing all week a chance to heal on its own.
select cron.schedule(
  'analytics-refresh-full-weekly',
  '17 3 * * 0',
  $cron$select analytics.refresh_all(true);$cron$);

-- Verify with:
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 20;

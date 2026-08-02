import { QuotaResult, checkDailyQuota } from "./rate-limit";

/**
 * Daily ceiling for the anonymous funnel's LLM calls, per browser + IP.
 *
 * These are the reads that happen BEFORE anyone signs up: the CV extraction,
 * the per-job company lookup and the merged question set. They are cheap
 * individually but callable without a session, so they need a ceiling of their
 * own — kept generous because one honest flow legitimately makes several
 * (1 CV + up to 5 job lookups + 1 question set), and deliberately separate
 * from the generation quota so a user reading job descriptions never spends
 * the free CVs they came for.
 */
export const FUNNEL_DAILY_LIMIT = 40;

export function funnelQuota(request: Request): QuotaResult {
  return checkDailyQuota(request, FUNNEL_DAILY_LIMIT, "funnel");
}

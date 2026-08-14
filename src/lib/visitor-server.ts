import { createHash, createHmac } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { VISITOR_HEADER } from "@/lib/visitor";

/**
 * Server-side half of visitor capture: read the id the proxy forwarded, build
 * the request context, and write it through the RPCs in migration 0014.
 *
 * Node-runtime route handlers only — it reaches for the service-role client,
 * because public.visitors / visits / funnel_events grant nothing to anon or
 * authenticated (see the RLS note in 0013).
 *
 * Every write here is best-effort and silent on failure. Analytics must never
 * be the reason a CV fails to parse or a job description fails to save; a
 * missing row is a gap in a chart, a thrown error is a broken product.
 */

export type VisitorCtx = Record<string, string | boolean>;

export function visitorId(request: Request): string | null {
  return request.headers.get(VISITOR_HEADER);
}

function hmac(value: string): string | undefined {
  const secret = process.env.ANALYTICS_COOKIE_SECRET;
  if (!secret || !value) return undefined;
  return createHmac("sha256", secret).update(value).digest("hex");
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "";
}

/** Coarse buckets only. The raw User-Agent is a fingerprint and is never stored. */
function parseUserAgent(ua: string) {
  const s = ua.toLowerCase();

  const bot =
    /bot|crawl|spider|slurp|headless|phantom|curl|wget|python-requests|axios|node-fetch|preview|monitor|lighthouse/.test(
      s
    );

  const deviceType = bot
    ? "bot"
    : /ipad|tablet|playbook|silk/.test(s)
      ? "tablet"
      : /mobi|iphone|ipod|android.*mobile|windows phone/.test(s)
        ? "mobile"
        : s
          ? "desktop"
          : "unknown";

  const osFamily = /windows nt/.test(s)
    ? "windows"
    : /iphone|ipad|ipod|ios/.test(s)
      ? "ios"
      : /mac os x|macintosh/.test(s)
        ? "macos"
        : /android/.test(s)
          ? "android"
          : /cros/.test(s)
            ? "chromeos"
            : /linux/.test(s)
              ? "linux"
              : "unknown";

  // Order matters: every Chromium browser also says "chrome", and Chrome and
  // Edge both say "safari". Most specific first.
  const browserFamily = /edg\//.test(s)
    ? "edge"
    : /opr\/|opera/.test(s)
      ? "opera"
      : /samsungbrowser/.test(s)
        ? "samsung"
        : /firefox|fxios/.test(s)
          ? "firefox"
          : /chrome|crios|chromium/.test(s)
            ? "chrome"
            : /safari/.test(s)
              ? "safari"
              : "unknown";

  return { bot, deviceType, osFamily, browserFamily };
}

/**
 * Everything the capture layer is allowed to know about this request.
 *
 * Note what is absent: no raw IP, no raw User-Agent, no full referrer. The
 * referrer contributes its HOST only — a referrer path carries the previous
 * page's query string, which is exactly the kind of thing that turns an
 * analytics table into a liability.
 */
/**
 * What the PAGE says about itself, when the request cannot say it.
 *
 * The beacon POSTs to /api/session/ping, so that request's URL is the ping
 * route and its Referer is the page — on our own host, and therefore dropped.
 * Reading only the request would record every landing as "/api/session/ping"
 * from nowhere, and lose acquisition entirely. These override the request.
 */
export type PageCtx = {
  path?: string;
  search?: string;
  referrer?: string;
};

export function visitorCtx(request: Request, page?: PageCtx): VisitorCtx {
  const url = new URL(request.url);
  const ua = request.headers.get("user-agent") ?? "";
  const { bot, deviceType, osFamily, browserFamily } = parseUserAgent(ua);

  // Query string: the page's own, when it supplied one.
  const params = page?.search
    ? new URLSearchParams(page.search)
    : url.searchParams;

  let referrerHost = "";
  const referrer = page?.referrer || request.headers.get("referer");
  if (referrer) {
    try {
      const host = new URL(referrer).host;
      // Same-host is internal navigation, not an acquisition source.
      if (host && host !== url.host) referrerHost = host;
    } catch {
      // unparseable referrer — treat as direct
    }
  }

  const ctx: VisitorCtx = {
    path: page?.path || url.pathname,
    referrer_host: referrerHost,
    utm_source: params.get("utm_source") ?? "",
    utm_medium: params.get("utm_medium") ?? "",
    utm_campaign: params.get("utm_campaign") ?? "",
    utm_term: params.get("utm_term") ?? "",
    utm_content: params.get("utm_content") ?? "",
    country: request.headers.get("x-vercel-ip-country") ?? "",
    device_type: deviceType,
    os_family: osFamily,
    browser_family: browserFamily,
    lang: (request.headers.get("accept-language") ?? "")
      .split(",")[0]
      .split("-")[0]
      .trim(),
    bot_suspect: bot || !ua,
    cookie_signed: Boolean(process.env.ANALYTICS_COOKIE_SECRET),
  };

  const ip = hmac(clientIp(request));
  if (ip) ctx.ip_hash = ip;
  const uaHash = hmac(ua);
  if (uaHash) ctx.ua_hash = uaHash;

  return ctx;
}

/**
 * Must produce byte-identical output to the jd_hash generated column in
 * migration 0012:
 *
 *   md5(regexp_replace(btrim(lower(jd_text)), '[[:space:]]+', ' ', 'g'))
 *
 * This hash is the ONLY link between a job description pasted anonymously and
 * the jobs row it becomes after signup, so the two implementations agreeing is
 * load-bearing. The explicit ASCII whitespace class is why: JavaScript's \s
 * also matches NBSP and friends, and .trim() strips a wider set than btrim, so
 * the obvious spelling would drift on exactly the Hebrew job descriptions this
 * product sees most. Sanity check S5 measures the real-world join rate.
 */
export function jdHash(jdText: string): string {
  const collapsed = jdText
    .toLowerCase()
    .replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, "")
    .replace(/[ \t\n\r\f\v]+/g, " ");
  return createHash("md5").update(collapsed, "utf8").digest("hex");
}

/** Word count for a JD, on the same collapsed text the hash uses. */
export function jdWords(jdText: string): number {
  const t = jdText.trim();
  return t ? t.split(/\s+/).length : 0;
}

export type FunnelEventType =
  | "visit_ping"
  | "cv_parsed"
  | "jd_submitted"
  | "questions_served"
  | "registration_wall_hit"
  | "signup_linked"
  | "import_completed"
  | "account_job_created";

export type FunnelPayload = Record<string, unknown>;

/**
 * supabase-js RETURNS its errors rather than throwing them, so a try/catch
 * around .rpc() catches transport failures and silently swallows every
 * "function does not exist" and every permission denial. Capture that runs but
 * records nothing is worse than capture that is switched off, because the
 * charts look plausible. Everything here funnels through this one check.
 */
function warnOn(label: string, error: { message: string } | null): void {
  if (error) console.warn(`[visitor] ${label} not recorded: ${error.message}`);
}

/**
 * Record one funnel milestone. Never throws.
 *
 * Call it inside after() from next/server so the user waits for nothing:
 *
 *   after(() => recordFunnelEvent(request, "jd_submitted", { ... }));
 */
export async function recordFunnelEvent(
  request: Request,
  eventType: FunnelEventType,
  payload: FunnelPayload = {},
  userId?: string | null
): Promise<void> {
  const visitor = visitorId(request);
  if (!visitor) return;
  try {
    const { error } = await createAdminClient().rpc("record_funnel_event", {
      p_visitor: visitor,
      p_event: eventType,
      p_ctx: visitorCtx(request),
      p_payload: payload,
      p_user: userId ?? null,
    });
    warnOn(eventType, error);
  } catch (e) {
    console.warn(`[visitor] ${eventType} not recorded:`, e);
  }
}

/** Open or extend the current visit. Used by the page beacon. Never throws. */
export async function touchVisit(
  request: Request,
  page?: PageCtx
): Promise<void> {
  const visitor = visitorId(request);
  if (!visitor) return;
  try {
    const { error } = await createAdminClient().rpc("touch_visit", {
      p_visitor: visitor,
      p_ctx: visitorCtx(request, page),
      p_server_created: false,
    });
    warnOn("visit", error);
  } catch (e) {
    console.warn("[visitor] visit not recorded:", e);
  }
}

/**
 * Pair this browser with the account, permanently. Never throws.
 *
 * userCreatedAt is how the signup visitor is identified: there is no trigger on
 * auth.users and no first-login flag anywhere in this codebase, so a freshly
 * created account is the only available signal. The claim is made at most once
 * per user — the partial unique index in 0013 enforces that, not this call.
 */
export async function linkVisitorUser(
  request: Request,
  userId: string,
  userCreatedAt?: string | null
): Promise<void> {
  const visitor = visitorId(request);
  if (!visitor) return;
  try {
    const { error } = await createAdminClient().rpc("link_visitor_user", {
      p_visitor: visitor,
      p_user: userId,
      p_user_created_at: userCreatedAt ?? null,
    });
    warnOn("signup link", error);
  } catch (e) {
    console.warn("[visitor] signup link not recorded:", e);
  }
}

/**
 * Erase this account's visitor data, and tombstone it for the warehouse.
 *
 * Unlike everything else here this one is NOT best-effort silent about intent:
 * it must run before the auth user is deleted, because afterwards there is no
 * way to find the rows. It still swallows its error rather than blocking the
 * deletion the user asked for — a failure is logged loudly and the tombstone
 * sweep catches the remainder.
 */
export async function purgeVisitorData(userId: string): Promise<void> {
  try {
    const { error } = await createAdminClient().rpc("purge_visitor_data", {
      p_user: userId,
    });
    if (error) console.error("[visitor] purge failed for", userId, error.message);
  } catch (e) {
    console.error("[visitor] purge failed for", userId, e);
  }
}

/** The visit id currently open for this browser, if any. Never throws. */
export async function currentVisitId(request: Request): Promise<string | null> {
  const visitor = visitorId(request);
  if (!visitor) return null;
  try {
    const { data, error } = await createAdminClient().rpc("touch_visit", {
      p_visitor: visitor,
      p_ctx: visitorCtx(request),
      p_server_created: true,
    });
    warnOn("visit lookup", error);
    return (data as string | null) ?? null;
  } catch (e) {
    console.warn("[visitor] visit lookup failed:", e);
    return null;
  }
}

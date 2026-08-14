import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/**
 * The durable anonymous visitor id.
 *
 * One id per browser, minted in src/proxy.ts on the first request and kept for
 * two years. It is what makes "how many people visited" answerable at all, and
 * it is deliberately NOT replaced at signup: the id keeps its own identity and
 * a permanent visitor <-> user link is recorded alongside it (public.visitor_users,
 * migration 0013), so the pre-signup history stays attached and a second device
 * can link to the same account without either id being overwritten.
 *
 * No database access here. This module is imported by the proxy, which runs on
 * every page navigation, every RSC prefetch and every API call — a round trip
 * to Supabase in that path would tax 100% of traffic for data needed on a small
 * fraction of it. The proxy mints and forwards; the writes happen in routes.
 *
 * The signed-cookie shape follows src/lib/rate-limit.ts, with one deliberate
 * difference: the secret. rate-limit's secret() falls through to GEMINI_API_KEY,
 * which is fine for a 24-hour counter and disastrous for a two-year identifier —
 * rotating the LLM key would silently invalidate every visitor cookie in the
 * wild and reset the entire visitor population to zero. This one reads a single
 * dedicated variable with no fallback chain.
 */

export const VISITOR_COOKIE = "specv_vid";

/**
 * How the resolved id reaches route handlers.
 *
 * A route cannot read the cookie instead: on a brand-new visitor's very first
 * request the cookie exists only in the RESPONSE, so request.cookies is empty
 * and the first job description of every new visitor would go unrecorded. The
 * header is present on request #1.
 */
export const VISITOR_HEADER = "x-specv-visitor";

/** Two years. Long enough that a returning candidate is still recognised. */
const MAX_AGE_SECONDS = 63_072_000;

/**
 * Re-issue the cookie once it is a week old, so the two-year window slides for
 * an active visitor. Doing it on every response would put a Set-Cookie header
 * on every RSC prefetch for no benefit.
 */
const REISSUE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const COOKIE_VERSION = 1;

export type VisitorCookie = {
  name: string;
  value: string;
  options: {
    path: string;
    maxAge: number;
    httpOnly: boolean;
    sameSite: "lax";
    secure: boolean;
  };
};

export type ResolvedVisitor = {
  id: string;
  /** Present when the caller must stamp it onto the response. */
  cookie: VisitorCookie | null;
  /**
   * False when ANALYTICS_COOKIE_SECRET is unset. The id is still minted and
   * still works, but it is signed with a per-process key that dies with the
   * instance, so ids churn. Recorded on public.visitors.cookie_signed rather
   * than pretended away — labelled data beats quietly wrong data.
   */
  signed: boolean;
};

/**
 * Ephemeral fallback key. Never persisted, never shared between instances:
 * its only job is to keep the cookie well-formed when the real secret is
 * missing, so a misconfigured deploy degrades instead of crashing.
 */
const EPHEMERAL_SECRET = randomUUID();

function configuredSecret(): string | null {
  const s = process.env.ANALYTICS_COOKIE_SECRET;
  return s && s.length > 0 ? s : null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

type Payload = { v: number; id: string; iat: number };

function parse(value: string | undefined, secret: string): Payload | null {
  if (!value) return null;
  const [dataB64, sig] = value.split(".");
  if (!dataB64 || !sig) return null;
  try {
    const expected = sign(dataB64, secret);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const parsed: unknown = JSON.parse(
      Buffer.from(dataB64, "base64url").toString("utf8")
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as Payload).id === "string" &&
      typeof (parsed as Payload).iat === "number"
    ) {
      return parsed as Payload;
    }
  } catch {
    // malformed or tampered — treat as absent and mint a fresh id
  }
  return null;
}

function serialize(payload: Payload, secret: string): string {
  const dataB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${dataB64}.${sign(dataB64, secret)}`;
}

function buildCookie(id: string, secret: string, https: boolean): VisitorCookie {
  return {
    name: VISITOR_COOKIE,
    value: serialize({ v: COOKIE_VERSION, id, iat: Date.now() }, secret),
    options: {
      path: "/",
      maxAge: MAX_AGE_SECONDS,
      httpOnly: true,
      // Lax is required AND sufficient: the OAuth callback is a top-level GET
      // navigation from the provider back to /auth/callback, and Lax cookies
      // ride along on those. That is what lets the visitor id survive the OAuth
      // round trip, which is the whole basis of the permanent signup link.
      sameSite: "lax",
      // rate-limit.ts sets Secure unconditionally. Browsers exempt localhost so
      // it works in practice, but it silently drops the cookie on a plain-http
      // LAN dev host. Don't inherit that.
      secure: https,
    },
  };
}

/**
 * Read the visitor id off the request, or mint one.
 *
 * Returns a cookie to stamp only when something changed — a new visitor, a
 * tampered or unreadable cookie, or one old enough to be worth re-issuing.
 * Signing does not stop someone from requesting the homepage a thousand times
 * and collecting a thousand valid ids; what it buys is that the browser cannot
 * choose its own id, collide with someone else's, or inject a header. Bot
 * inflation is handled by only creating visit rows from the page beacon.
 */
export function resolveVisitor(request: NextRequest): ResolvedVisitor {
  const configured = configuredSecret();
  const secret = configured ?? EPHEMERAL_SECRET;
  const signed = configured !== null;
  const https = request.nextUrl.protocol === "https:";

  const existing = parse(request.cookies.get(VISITOR_COOKIE)?.value, secret);

  if (existing) {
    const stale = Date.now() - existing.iat > REISSUE_AFTER_MS;
    return {
      id: existing.id,
      cookie: stale ? buildCookie(existing.id, secret, https) : null,
      signed,
    };
  }

  const id = randomUUID();
  return { id, cookie: buildCookie(id, secret, https), signed };
}

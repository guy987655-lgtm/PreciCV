import { createHmac, timingSafeEqual } from "crypto";

/**
 * Anonymous per-browser + per-IP daily quota for the V1 public launch
 * (no accounts, no payment yet). State lives in a signed cookie (primary —
 * survives cold starts) plus a best-effort in-memory per-IP map (soft
 * backstop against a cleared cookie on the same warm serverless instance).
 * No database, no external service. Good enough to cap API cost until the
 * product earns; swap for Redis/Upstash if real abuse shows up.
 */

const COOKIE_NAME = "precicv_quota";
const DAY_MS = 24 * 60 * 60 * 1000;

function secret(): string {
  return (
    process.env.RATE_LIMIT_SECRET ||
    process.env.GEMINI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    "precicv-dev-secret"
  );
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

type QuotaPayload = { count: number; windowStart: number };

function parseCookie(header: string | null): QuotaPayload | null {
  if (!header) return null;
  const match = header.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const value = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  const [dataB64, sig] = value.split(".");
  if (!dataB64 || !sig) return null;
  try {
    const expected = sign(dataB64);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const parsed = JSON.parse(Buffer.from(dataB64, "base64url").toString("utf8"));
    if (typeof parsed.count === "number" && typeof parsed.windowStart === "number") {
      return parsed;
    }
  } catch {
    // malformed / tampered cookie — treat as absent
  }
  return null;
}

function serializeCookie(payload: QuotaPayload): string {
  const dataB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${dataB64}.${sign(dataB64)}`;
}

/** Best-effort IP tracking. Resets on cold start; not shared across regions. */
const ipHits = new Map<string, QuotaPayload>();

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}

export type QuotaResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
  /** Cookie reflecting the CURRENT (uncommitted) state — for 429 responses. */
  cookieHeader: string;
  /**
   * Consumes one unit (cookie + IP counters) and returns the updated
   * Set-Cookie header. Call ONLY after the expensive work succeeded —
   * a failed generation must not burn the user's daily quota.
   */
  commit: () => string;
};

export function checkDailyQuota(request: Request, limit: number): QuotaResult {
  const now = Date.now();

  let cookiePayload = parseCookie(request.headers.get("cookie"));
  if (!cookiePayload || now - cookiePayload.windowStart > DAY_MS) {
    cookiePayload = { count: 0, windowStart: now };
  }

  const ip = clientIp(request);
  let ipPayload = ipHits.get(ip);
  if (!ipPayload || now - ipPayload.windowStart > DAY_MS) {
    ipPayload = { count: 0, windowStart: now };
  }

  // Whichever counter (cookie or IP) has seen more use wins — clearing
  // cookies alone doesn't reset the IP-side counter within the same
  // warm instance, and a shared cookie across browsers still respects
  // the per-IP ceiling.
  const usedSoFar = Math.max(cookiePayload.count, ipPayload.count);
  const allowed = usedSoFar < limit;
  const windowStart = cookiePayload.windowStart;
  const resetAt = new Date(windowStart + DAY_MS);

  const toHeader = (payload: QuotaPayload) => {
    const maxAge = Math.max(1, Math.floor((resetAt.getTime() - now) / 1000));
    return (
      `${COOKIE_NAME}=${encodeURIComponent(serializeCookie(payload))}; ` +
      `Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`
    );
  };

  return {
    allowed,
    remaining: Math.max(0, limit - usedSoFar - 1),
    limit,
    resetAt,
    cookieHeader: toHeader(cookiePayload),
    commit: () => {
      const nextCount = usedSoFar + 1;
      ipHits.set(ip, { count: nextCount, windowStart: ipPayload!.windowStart });
      if (ipHits.size > 5000) {
        const cutoff = now - DAY_MS;
        for (const [k, v] of ipHits) if (v.windowStart < cutoff) ipHits.delete(k);
      }
      return toHeader({ count: nextCount, windowStart });
    },
  };
}

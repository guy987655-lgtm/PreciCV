import { NextResponse } from "next/server";
import { z } from "zod";
import { MasterProfileSchema } from "@/lib/types";
import {
  generateTailoredCv,
  llmConfigured,
  LLM_NOT_CONFIGURED_MSG,
} from "@/lib/llm";
import { checkDailyQuota } from "@/lib/rate-limit";

export const maxDuration = 300;

/**
 * One free generation per day. The cap is enforced per IP (see
 * src/lib/rate-limit.ts) as well as per browser cookie, so opening an
 * Incognito window — which drops the cookie but keeps the IP — does not
 * grant a second free CV.
 */
const DAILY_LIMIT = 1;

/**
 * Temporarily disables the daily quota — generation is unlimited while this
 * is true. Flip back to `false` (or delete this flag) to re-enable the
 * per-day cap; the rate-limit machinery below is left intact for that.
 */
const QUOTA_DISABLED = true;

const BodySchema = z.object({
  profile: MasterProfileSchema,
  jdText: z.string().min(100),
});

/**
 * V1 public launch: anonymous, no-account, no-payment tailored CV
 * generation straight from the funnel's local profile + job text. Nothing
 * is persisted server-side. Rate-limited per browser+IP (see
 * src/lib/rate-limit.ts) since there is no account/purchase to gate on.
 */
export async function POST(request: Request) {
  if (!llmConfigured()) {
    return NextResponse.json({ error: LLM_NOT_CONFIGURED_MSG }, { status: 503 });
  }

  const quota = QUOTA_DISABLED ? null : checkDailyQuota(request, DAILY_LIMIT);
  if (quota && !quota.allowed) {
    const res = NextResponse.json(
      {
        error: "quota_exceeded",
        message:
          `You've used your free ${quota.limit === 1 ? "CV" : `${quota.limit} CVs`} for today. ` +
          `Come back after ${quota.resetAt.toLocaleString()} for another.`,
        resetAt: quota.resetAt.toISOString(),
      },
      { status: 429 }
    );
    res.headers.set("Set-Cookie", quota.cookieHeader);
    return res;
  }

  const parsed = BodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await generateTailoredCv(parsed.data.profile, parsed.data.jdText);
    // Quota is consumed only on success — a failed run costs the user nothing.
    const setCookie = quota?.commit();
    const res = NextResponse.json({
      ...result,
      remaining: quota?.remaining ?? null,
    });
    if (setCookie) res.headers.set("Set-Cookie", setCookie);
    return res;
  } catch (e) {
    console.error("try/generate failed:", e);
    const message =
      e instanceof Error && e.message.includes("overloaded")
        ? e.message
        : "Generation failed. Please try again in a moment.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
